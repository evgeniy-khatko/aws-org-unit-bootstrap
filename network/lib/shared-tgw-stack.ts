import { Stack } from "aws-cdk-lib";
import {
  AclCidr,
  CfnTransitGateway,
  CfnTransitGatewayPeeringAttachment,
  CfnTransitGatewayRoute,
} from "aws-cdk-lib/aws-ec2";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnResourceShare } from "aws-cdk-lib/aws-ram";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { HostNetworkInfo } from "./host-network-info";
import { OuProps } from "./ou-props";
import { ResourceNameProducer } from "./resource-name-producer";

export interface SharedTgwStackProps extends OuProps {
  hostNetworkInfo: HostNetworkInfo;
  isAttachmentReady: boolean;
  forceOutboundTrafficThroughHostNetwork: boolean;
}

/**
 * Creates TGW, connects it to Host network and shares this TGW across OU accounts.
 * Each OU account VPC will then connect to this TGW.
 */
export class SharedTgwStack extends Stack {
  private readonly names: ResourceNameProducer;

  constructor(scope: Construct, id: string, props: SharedTgwStackProps) {
    super(scope, id, props);

    if (this.account != props.sharedAccount.accountId) {
      console.error(
        `This stack must be deployed in a Shared OU account [${props.sharedAccount.accountId}]. Current account is [${this.account}].`
      );
      throw "";
    }
    this.names = new ResourceNameProducer(props.ouName);

    const sharedTGW = this.createSharedTGW();
    const sharedTgwRouteTableId =
      this.getSharedTgwDefaultRouteTableId(sharedTGW);
    this.shareTGW(sharedTGW, props);
    const hostNetworkAttachment = this.attachSharedTgwToHostNetwork(
      sharedTGW,
      props.hostNetworkInfo,
    );

    if (props.isAttachmentReady) {
      this.routeTrafficWithinSharedTgw(
          sharedTgwRouteTableId,
          hostNetworkAttachment,
          props
      );
    }

    this.exportValue(sharedTGW.attrId, {
      name: this.names.produceFromStack("SharedTgwId", this),
    });
    this.exportValue(hostNetworkAttachment.attrTransitGatewayAttachmentId, {
      name: this.names.produceFromStack("HostAttachmentId", this),
    });
    this.exportValue(sharedTgwRouteTableId, {
      name: this.names.produceFromStack("SharedTgwRouteTableId", this),
    });
  }

  private createSharedTGW(): CfnTransitGateway {
    return new CfnTransitGateway(this, "SharedTgw", {
      autoAcceptSharedAttachments: "enable", // to be able to automatically attach OU account VPCs to this TGW
      defaultRouteTableAssociation: "enable", // to send all traffic coming to this TGW to the default routing table
      defaultRouteTablePropagation: "enable", // to automatically propagate traffic destined to an attached VPC to that VPC
    });
  }

  private shareTGW(sharedTGW: CfnTransitGateway, props: SharedTgwStackProps) {
    const ouPrincipals = [
      props.devAccount.accountId,
      props.prodAccount.accountId,
    ];

    new CfnResourceShare(this, "TgwShare", {
      name: this.names.produceFromStack("TgwShare", this),
      /**
       * Specifies whether principals outside your organization in AWS Organizations can be associated with a resource share.
       * A value of `true` lets you share with individual AWS accounts that are *not* in your organization.
       * A value of `false` only has meaning if your account is a member of an AWS Organization.
       * The default value is `true` .
       *
       * Note that `false` value will allow sharing across OU accounts _only_ if Organization level sharing was explicitly allowed in ResourceSharingManager
       * settings in the OU management account. See: https://github.com/hashicorp/terraform-provider-aws/issues/7769 for details.
       *
       * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ram-resourceshare.html#cfn-ram-resourceshare-allowexternalprincipals
       */
      allowExternalPrincipals: false,
      principals: ouPrincipals,
      resourceArns: [this.buildTgwArn(sharedTGW)],
    });
  }

  private attachSharedTgwToHostNetwork(
    sharedTGW: CfnTransitGateway,
    hostNetworkInfo: HostNetworkInfo,
  ): CfnTransitGatewayPeeringAttachment {
    return new CfnTransitGatewayPeeringAttachment(
      this,
      "HostTgwAttachment",
      {
        peerRegion: hostNetworkInfo.tgwRegion,
        peerAccountId: hostNetworkInfo.accountId,
        peerTransitGatewayId: hostNetworkInfo.tgwId,
        transitGatewayId: sharedTGW.attrId,
        tags: [
          {
            key: "Name",
            value: `attach-to-host-network`,
          }
        ]
      }
    );
  }

  private routeTrafficWithinSharedTgw(
    sharedTgwRouteTableId: string,
    hostNetworkAttachment: CfnTransitGatewayPeeringAttachment,
    props: SharedTgwStackProps
  ) {
    // Depending on the forceOutboundTrafficThroughHostNetwork setting the destination would be
    // only traffic destined to Host network if forceOutboundTrafficThroughHostNetwork=false
    // or all traffic if forceOutboundTrafficThroughHostNetwork=true; the host network is expected to control and route traffic properly
    const destinationCidr = (props.forceOutboundTrafficThroughHostNetwork)?
        AclCidr.anyIpv4().toCidrConfig().cidrBlock : props.hostNetworkInfo.tgwCIDR
    new CfnTransitGatewayRoute(this, "StaticRouteToHostWithinTGW", {
      transitGatewayRouteTableId: sharedTgwRouteTableId,
      destinationCidrBlock: destinationCidr,
      transitGatewayAttachmentId:
        hostNetworkAttachment.attrTransitGatewayAttachmentId,
    });
  }

  private buildTgwArn(tgw: CfnTransitGateway) {
    // It's a workaround for the issue bellow
    // see https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/61
    return `arn:aws:ec2:${this.region}:${this.account}:transit-gateway/${tgw.ref}`;
  }

  private getSharedTgwDefaultRouteTableId(
    sharedTGW: CfnTransitGateway
  ): string {
    // It's a workaround for the issue below
    // https://stackoverflow.com/questions/71073745/transitgatewayroutetableid-for-default-transitgatewayroutetable

    // https://docs.aws.amazon.com/cdk/api/latest/docs/custom-resources-readme.html#custom-resources-for-aws-apis
    return new AwsCustomResource(this, "getSharedTgwDefaultRouteTableId", {
      installLatestAwsSdk: false,
      onCreate: {
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#describeTransitGateways-property
        service: "EC2",
        action: "describeTransitGateways",
        parameters: {
          TransitGatewayIds: [`${sharedTGW.attrId}`],
        },
        physicalResourceId: PhysicalResourceId.fromResponse(
          "TransitGateways.0.Options.AssociationDefaultRouteTableId"
        ),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        // Will automatically apply only describeTransitGateways action
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      logRetention: RetentionDays.ONE_DAY,
      functionName: "getSharedTgwDefaultRouteTableId",
    }).getResponseField(
      "TransitGateways.0.Options.AssociationDefaultRouteTableId"
    );
  }
}
