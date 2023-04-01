import { RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AclCidr,
  CfnRoute,
  CfnTransitGatewayVpcAttachment,
  FlowLog,
  FlowLogDestination,
  FlowLogResourceType,
  GatewayVpcEndpointAwsService, IpAddresses,
  ISubnet,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { AccountInfo, OuProps } from "./ou-props";
import { ResourceNameProducer } from "./resource-name-producer";

export interface VpcStackProps extends OuProps {
  hostNetworkCIDR: string;
  sharedTgwId: string;
  sharedTgwRouteTableId: string;
  forceOutboundTrafficThroughHostNetwork: boolean
  maxAzsInProdAccount?: number;
  vpcFlowlogsRetentionInDays?: number;
  vpcFlowLogsKmsArn?: string;
}

/**
 * Creates VPC with 3 Subnets and a number of AZs identified by consumer.
 * Creates Internet Gateway for public subnet and NAT gateway for private subnets in Prod and Shared accounts. Non-prod traffic will be routed to Shared NAT.
 * Isolated subnet is left isolated, it's OUs infrastructure responsibility to establish connectivity to isolated subnets.
 * Attaches private subnets to Shated TGW. Establishes routes from private subnets to shared TGW.
 * Exports flow logs to an encrypted CW log group. It is ou-logging-infrastructure responsibility to transfers flow logs from CW to Splunk.
 *
 * Please consult repository README for visual representation of this structure.
 */
export class VpcStack extends Stack {
  private static DEFAULT_AZS_NUMBER_IN_PROD = 1

  private readonly names: ResourceNameProducer;
  private readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);
    this.names = new ResourceNameProducer(props.ouName);

    /**
     * Creates a VPC that spans a whole region.
     * Infrastructure will automatically divide provided VPC CIDR range, and create public, private and isolated subnets per Availability Zone.
     *
     * This VPC will not apply any Network ACLs. Security groups and Routing rules are primary security mechanisms.
     * If you don't associate a security group when you create the resource, AWS associates the default security group with it.
     * This Security group allows inbound connections from instances within the same SecurityGroup. Outbound traffic is allowed by default.
     * Private subnets will use NAT Gateways to send traffic to Internet.
     *
     * It is consumer's responsibility to create project's specific security groups for each communication pattern.
     */
    this.vpc = new Vpc(this, "Vpc", {
      vpcName: `${this.names.produceFromStack("Vpc", this)}`,
      ipAddresses: IpAddresses.cidr(this.getVpcCIDR(props)),
      /**
       * 2 AZs would be enough for High Availability, but there's services which require to "Maintain Quorum", e.g. ElasticSearch, Kafka, etc.
       * These services will require 2 AZs to operate even if one AZ goes down, they require 3 AZs.
       * (source: https://chariotsolutions.com/blog/post/how-many-availability-zones-do-you-need/)
       *
       * Costs associated with an additional AZ are associated with either additional NAT gateway (at $32/month) or cross-az traffic (at ~20c/10GB).
       * Usually there's not a lot of outbound traffic, so prevealing part is associated with an additional NAT gateway hourly costs.
       *
       * Based on these details this infrastructure uses following logic:
       * - By default creates 2 AZs with 2 NATs in Prod account: one NAT per AZ
       * - Exposes a parameter on number of AZ + NAT in Prod account (for OUs hosting ElasticSearch or Kafka or Heavy load traffic)
       * - Creates number of AZs same as in Prod in every non-Prod account without a NAT
       * - Creates number of AZs same as in Prod in a shared account with NAT Gateway
       * - Routes outbound non-prod traffic to a Shared account NAT
       */
      natGateways: this.identifyNatGatewaysNumber(props),
      maxAzs: this.identifyAZsNumber(props),
      subnetConfiguration: [
        {
          /**
           * Subnet connected to the Internet
           *
           * Instances in a Public subnet can connect to the Internet and can be
           * connected to from the Internet as long as they are launched with public
           * IPs (controlled on the AutoScalingGroup or other constructs that launch
           * instances).
           *
           * Public subnets route outbound traffic via an Internet Gateway.
           */
          name: "public",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 19,
        },

        {
          /**
           * Subnet that routes to the internet (via a NAT gateway), but not vice versa.
           *
           * Instances in a private subnet can connect to the Internet, but will not
           * allow connections to be initiated from the Internet.
           *
           * Normally a Private subnet will use a NAT gateway in the same AZ, but
           * if `natGateways` is used to reduce the number of NAT gateways, a NAT
           * gateway from another AZ will be used instead.
           * Uses either shared account NAT or sets up its own NAT depending on forceOutboundTrafficThroughSharedNAT property.
           * See network diagram in README to visualize.
           *
           */
          name: "private",
          subnetType: (this.isSharedAccount(props) || !props.forceOutboundTrafficThroughHostNetwork)?
              SubnetType.PRIVATE_WITH_EGRESS : SubnetType.PRIVATE_ISOLATED,
          cidrMask: 20,
        },

        {
          /**
           * Isolated Subnets do not route traffic to the Internet (in this VPC),
           * and as such, do not require NAT gateways.
           *
           * Isolated subnets can only connect to or be connected to from other
           * instances in the same VPC.
           *
           * This can be good for subnets with RDS or Elasticache instances,
           * or which route Internet traffic through a peer VPC.
           *
           * This infrastructure will not add any routes from isolated subnets.
           * VPC consumers should add routes on per-project basis.
           */
          name: "isolated",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 21,
        },
      ],

      /**
       * Connecting to DynamoDB and S3 through VPC endpoints to keep this traffic within AWS network:
       * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/vpc-endpoints-dynamodb.html
       */
      gatewayEndpoints: {
        S3: {
          service: GatewayVpcEndpointAwsService.S3,
        },
        DynamoDB: {
          service: GatewayVpcEndpointAwsService.DYNAMODB,
        },
      },
    });

    const tgwAttachment = this.attachVpcPrivateSubsToSharedTGW(props);
    this.routeTrafficToSharedTGW(props, tgwAttachment);
    this.exportFlowLogsToCloudWatch(this.vpc, props);

    this.exportValue(this.vpc.vpcId, {
      name: this.names.produceFromStack("VpcId", this),
    });
  }

  /**
   * Attaches private workload subnets to a shared TGW.
   * Note: Public and Isolated subnets are not supposed to be attached.
   */
  private attachVpcPrivateSubsToSharedTGW(props: VpcStackProps) {
    return new CfnTransitGatewayVpcAttachment(
      this,
      "VpcAttachmentToSharedTgw",
      {
        vpcId: this.vpc.vpcId,
        subnetIds: this.privateSubnets().map((subnet) => {
          return subnet.subnetId;
        }),
        transitGatewayId: props.sharedTgwId,
        tags: [
          {
            key: "Name",
            value: `attach-to-${this.account}-private`,
          }
        ]
      }
    );
  }

  /**
   * Creates routes to route Private traffic to host network via Shared TGW.
   * - Does not allow cross VPC/Workload communications. E.g. Dev VPC should not be able to talk to Prod VPC or Shared VPC, etc.
   * - Does not allow Public or Isolated traffic to communicate to Host network.
   *
   * Creates routes to route Internet traffic to host network via Shared TGW if forceOutboundTrafficThroughHostNetwork.
   *
   * This infrastructure offloads DNS resolution to Host network. This infrastructure does not set up DNS rules.
   *
   */
  private routeTrafficToSharedTGW(
    props: VpcStackProps,
    sharedTgwAttachment: CfnTransitGatewayVpcAttachment
  ) {
    // Depending on the forceOutboundTrafficThroughHostNetwork setting the destination would be
    // only private subnets traffic if forceOutboundTrafficThroughHostNetwork=false because in this case private subnets have their own internet connection through NAT
    // all traffic if forceOutboundTrafficThroughHostNetwork=true; the host network is expected to control and route traffic properly
    const destinationCidr = (props.forceOutboundTrafficThroughHostNetwork)?
        AclCidr.anyIpv4().toCidrConfig().cidrBlock : props.hostNetworkCIDR

    this.privateSubnets().forEach(({ routeTable: { routeTableId } }, index) => {
      new CfnRoute(this, `RouteToHostViaSharedTgw-${index}`, {
        destinationCidrBlock: destinationCidr,
        routeTableId,
        transitGatewayId: props.sharedTgwId,
      }).addDependency(sharedTgwAttachment);
    });
  }

  /**
   * We export VPC flow logs to CloudWatch and keep them for 3 days.
   * We have a separate logging infrastructure which trasfers CloudWatch logs
   * into KinesisFirehose of the Shared account stream and eventually into Splunk.
   *
   * 3 days retention ensures enough buffer to ship the logs as well as low storage costs.
   */
  private exportFlowLogsToCloudWatch(vpc: Vpc, props: VpcStackProps) {
    // TODO: create a separate stack to create and export KMS key for logs encryption
    // these keys should be accessible by all accounts within OU.
    // Since the key is required at the point of time when pipelines are not available yet,
    // we need to create them as part of VPC setup and export.

    const logGroup = new LogGroup(this, "FlowLogsGroup", {
      retention: props.vpcFlowlogsRetentionInDays || RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
      logGroupName: this.names.produceFromStack("FlowLogsGroup", this),
    });

    new FlowLog(this, "FlowLog", {
      resourceType: FlowLogResourceType.fromVpc(vpc),
      destination: FlowLogDestination.toCloudWatchLogs(logGroup),
      flowLogName: this.names.produceFromStack("FlowLog", this),
    });
  }

  private identifyNatGatewaysNumber(props: VpcStackProps): number {
    let natNumber = 0;
    if (!props.forceOutboundTrafficThroughHostNetwork) {
      // if traffic is not forced to Host network
      // then using single NAT to save on costs in all non-prod accounts
      natNumber = 1;
      // using number of NATs equal to number of AZs for High Availability
      if (props.prodAccount.accountId == this.account) {
        natNumber = this.identifyAZsNumber(props)
      }
    }
    return natNumber;
  }

  private identifyAZsNumber(props: VpcStackProps): number {
    let azsNumber = VpcStack.DEFAULT_AZS_NUMBER_IN_PROD;
    if (
      props.prodAccount.accountId == this.account &&
      props.maxAzsInProdAccount
    ) {
      azsNumber = props.maxAzsInProdAccount;
    }
    return azsNumber;
  }

  private isSharedAccount(props: VpcStackProps): boolean {
    return this.account == props.sharedAccount.accountId
  }

  private privateSubnets(): ISubnet[] {
    /**
     * Querying by group name ensures we get correct list for both Prod and non-Prod accounts.
     * For Prod accounts we use PRIVATE_WITH_EGRESS subnet types and for non-prod it's PRIVATE_ISOLATED.
     */
    return this.vpc.selectSubnets({
      subnetGroupName: "private",
    }).subnets;
  }

  private getVpcCIDR(props: OuProps): string {
    for (const [, maybeAccountInfo] of Object.entries(props)) {
      if (
        (maybeAccountInfo as AccountInfo) &&
        (maybeAccountInfo as AccountInfo).accountId
      ) {
        if (maybeAccountInfo.accountId == this.account) {
          return maybeAccountInfo.vpcCIDR;
        }
      }
    }
    return "UNDEFINED_VPC_CIDR";
  }

}
