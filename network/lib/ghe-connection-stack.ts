import { Fn, Stack } from "aws-cdk-lib";
import { CfnConnection } from "aws-cdk-lib/aws-codestarconnections";
import { IVpc, Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
  PhysicalResourceIdReference,
} from "aws-cdk-lib/custom-resources";
import { actions } from "cdk-iam-actions";
import { Construct } from "constructs";
import { OuProps } from "./ou-props";
import { ResourceNameProducer } from "./resource-name-producer";

/**
 * GHE connection parameters structure.
 */
export interface GheConnectionStackProps extends OuProps {
  sharedVpcId: string;
  gheNetworkCIDR: string;
  // GitHub ORG names your AWS OU needs to be connected to
  gheOrgNames: string[];
  gheEndpoint: string;
  gheCertificatePEM?: string
}

/**
 * This stack deploys a single GHE connection to allow connectivity from On-premise/Company GHE into AWS.
 * Every OU would require one GHE connection in their "Shared" account where all the code delivery pipelines live.
 */
export class GheConnectionStack extends Stack {

  // Following export name should be used to identify connectionArn in pipeline stacks
  private static readonly GHE_CONNECTION_EXPORT_NAME="gheConnectionArn";

  private sharedVpc: IVpc;
  private names: ResourceNameProducer;

  constructor(scope: Construct, id: string, props: GheConnectionStackProps) {
    super(scope, id, props);

    if (this.account != props.sharedAccount.accountId) {
      console.error(
        `This stack must be deployed in a Shared OU account [${props.sharedAccount.accountId}]. Current account is [${this.account}].`
      );
      throw "";
    }

    this.names = new ResourceNameProducer(props.ouName);

    this.sharedVpc = Vpc.fromLookup(this, "SharedVpc", {
      vpcId: props.sharedVpcId,
    });

    const sgForGhe = new SecurityGroup(this, "SecurityGroupForGHE", {
      vpc: this.sharedVpc,
      allowAllOutbound: true,
      description:
        "security group for a GHE host which communicates with PPL GHE server",
    });

    sgForGhe.addIngressRule(
      Peer.ipv4(props.gheNetworkCIDR),
      Port.tcp(443),
      "allow HTTPS traffic from GHE"
    );

    const host = this.createCodestarHost([sgForGhe.securityGroupId], props.gheEndpoint, props.gheCertificatePEM);

    props.gheOrgNames.forEach((gheOrgName) => {
      const connection = new CfnConnection(
        this,
          `ConnToGHEFor-${gheOrgName}`,
        {
          // ConnectionName: expected maxLength: 32
          connectionName:
            `${gheOrgName}+${props.ouName}-${this.account}`.substring(0, 32),
          hostArn: host.getResponseField("HostArn"),
        }
      );

      this.exportValue(connection.attrConnectionArn, {
        name: GheConnectionStack.GHE_CONNECTION_EXPORT_NAME,
      });
      const connectionId = Fn.select(
        1,
        Fn.split("/", connection.attrConnectionArn)
      );
      this.exportValue(
        `https://${this.region}.console.aws.amazon.com/codesuite/settings/${this.account}/${this.region}/connections/${connectionId}`,
        {
          name: this.names.produceFromStack(
              `ConnUrlFor-${gheOrgName}`,
            this
          ),
        }
      );
    });
  }

  private createCodestarHost(securityGroupIds: string[], gheEndpoint: string, gheCertificatePEM?: string): AwsCustomResource {
    // https://docs.aws.amazon.com/cdk/api/latest/docs/custom-resources-readme.html#custom-resources-for-aws-apis
    return new AwsCustomResource(this, "CodestarHost", {
      installLatestAwsSdk: false,
      onCreate: {
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CodeStarconnections.html#createHost-property
        service: "CodeStarconnections",
        action: "createHost",
        parameters: {
          Name: this.names.produceFromStack("CodestarHost", this),
          ProviderEndpoint: gheEndpoint,
          ProviderType: "GitHubEnterpriseServer",
          VpcConfiguration: {
            VpcId: this.sharedVpc.vpcId,
            SubnetIds: this.sharedVpc.privateSubnets.map((subnet) => {
              return subnet.subnetId;
            }),
            SecurityGroupIds: securityGroupIds,
            // Only required if GHE runs under self-signed certificate
            TlsCertificate: gheCertificatePEM
          },
        },
        physicalResourceId: PhysicalResourceId.fromResponse("HostArn"),
      },
      onDelete: {
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CodeStarconnections.html#deleteHost-property
        service: "CodeStarconnections",
        action: "deleteHost",
        ignoreErrorCodesMatching: "ValidationException",
        parameters: {
          HostArn: new PhysicalResourceIdReference(),
        },
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          resources: [
            `arn:aws:codestar-connections:${this.region}:${this.account}:*`,
          ],
          actions: [
            "codestar-connections:CreateHost",
            "codestar-connections:DeleteHost",
          ],
          effect: Effect.ALLOW,
        }),
        new PolicyStatement({
          resources: ["*"],
          // https://docs.aws.amazon.com/dtconsole/latest/userguide/troubleshooting-connections.html#troubleshooting-connections-host-vpc
          actions: [
            actions.EC2.CREATE_NETWORK_INTERFACE,
            actions.EC2.DESCRIBE_NETWORK_INTERFACES,
            actions.EC2.DELETE_NETWORK_INTERFACE,
            actions.EC2.CREATE_VPC_ENDPOINT,
            actions.EC2.DELETE_VPC_ENDPOINTS,
            actions.EC2.DESCRIBE_VPC_ENDPOINTS,
            actions.EC2.CREATE_TAGS,
            actions.EC2.DESCRIBE_SUBNETS,
            actions.EC2.DESCRIBE_VPCS,
            actions.EC2.DESCRIBE_DHCP_OPTIONS,
          ],
          effect: Effect.ALLOW,
        }),
      ]),
    });
  }
}
