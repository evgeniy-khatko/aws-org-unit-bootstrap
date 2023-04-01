#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import "source-map-support/register";
import { SharedTgwStack } from "../lib/shared-tgw-stack";
import { VpcStack } from "../lib/vpc-stack";
import { GheConnectionStack } from "./../lib/ghe-connection-stack";
import { getHostNetworkInfo } from "../lib/host-network-info";
import { OuProps } from "./../lib/ou-props";
import { readFileSync } from 'fs';

/**
 * This is the entry point for the project. Values defined here are specific for each OU.
 */

const app = new App();

const required_parameters = [
  "OU_NAME",
  "SHARED_ACCOUNT_ID",
  "PROD_ACCOUNT_ID",
  "DEV_ACCOUNT_ID",
  "FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK",
  "GITHUB_ENDPOINT",
  "GITHUB_ORG_NAMES",
];
required_parameters.forEach((parameter) => {
  if (!process.env[parameter]) {
    throw new Error(
      `Following parameters are required: ${required_parameters}. Run "export ${parameter}=<value>".`
    );
  }
});

const awsRegion = process.env.AWS_REGION || "us-west-2";
const ouName = process.env.OU_NAME || "UNSET_OU_NAME";
const forceOutboundTrafficThroughHostNetwork = (process.env.FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK == "true")
const githubOrgNames = (process.env.GITHUB_ORG_NAMES || "UNSET_GITHUB_ORG_NAMES")
    .split(",").map((orgName) => orgName.trim());
const gheCertificatePEM = (process.env.GITHUB_TLS_CERT_FILE)? readFileSync(process.env.GITHUB_TLS_CERT_FILE, "utf-8"): undefined;
const gheEndpoint = process.env.GITHUB_ENDPOINT || "UNSET_GHE_ENDPOINT";

const ouProps: OuProps = {
  ouName,
  sharedAccount: {
    accountId: process.env.SHARED_ACCOUNT_ID || "UNSET_SHARED_ACCOUNT_ID",
    awsRegion,
    vpcCIDR: "10.0.0.0/16",
  },
  prodAccount: {
    accountId: process.env.PROD_ACCOUNT_ID || "UNSET_PROD_ACCOUNT_ID",
    awsRegion,
    vpcCIDR: "10.1.0.0/16",
  },
  devAccount: {
    accountId: process.env.DEV_ACCOUNT_ID || "UNSET_DEV_ACCOUNT_ID",
    awsRegion,
    vpcCIDR: "10.2.0.0/16",
  },
};

new SharedTgwStack(app, "SharedTgwStack", {
  ...ouProps,
  hostNetworkInfo: getHostNetworkInfo(),
  isAttachmentReady: app.node.tryGetContext(
      "attached-to-host"
  ) == "true",
  forceOutboundTrafficThroughHostNetwork,
  env: {
    account: ouProps.sharedAccount.accountId,
    region: ouProps.sharedAccount.awsRegion,
  },
});

new VpcStack(app, "SharedVpcStack", {
  ...ouProps,
  hostNetworkCIDR: getHostNetworkInfo().tgwCIDR,
  sharedTgwId: process.env.SHARED_TGW_ID || "UNSET_SHARED_TGW_ID",
  sharedTgwRouteTableId:
    process.env.SHARED_TGW_RT_ID || "UNSET_SHARED_TGW_RT_ID",
  forceOutboundTrafficThroughHostNetwork,
  env: {
    account: ouProps.sharedAccount.accountId,
    region: ouProps.sharedAccount.awsRegion,
  },
});

new VpcStack(app, "ProdVpcStack", {
  ...ouProps,
  hostNetworkCIDR: getHostNetworkInfo().tgwCIDR,
  sharedTgwId: process.env.SHARED_TGW_ID || "UNSET_SHARED_TGW_ID",
  sharedTgwRouteTableId:
    process.env.SHARED_TGW_RT_ID || "UNSET_SHARED_TGW_RT_ID",
  forceOutboundTrafficThroughHostNetwork,
  env: {
    account: ouProps.prodAccount.accountId,
    region: ouProps.prodAccount.awsRegion,
  },
});

new VpcStack(app, "DevVpcStack", {
  ...ouProps,
  hostNetworkCIDR: getHostNetworkInfo().tgwCIDR,
  sharedTgwId: process.env.SHARED_TGW_ID || "UNSET_SHARED_TGW_ID",
  sharedTgwRouteTableId:
    process.env.SHARED_TGW_RT_ID || "UNSET_SHARED_TGW_RT_ID",
  forceOutboundTrafficThroughHostNetwork,
  env: {
    account: ouProps.devAccount.accountId,
    region: ouProps.devAccount.awsRegion,
  },
});

new GheConnectionStack(app, "GheConnectionStack", {
  sharedVpcId: process.env.SHARED_VPC_ID || "UNSET_SHARED_VPC_ID",
  ...ouProps,
  gheNetworkCIDR: getHostNetworkInfo().tgwCIDR,
  gheOrgNames: githubOrgNames,
  gheCertificatePEM,
  gheEndpoint,
  env: {
    account: ouProps.sharedAccount.accountId,
    region: ouProps.sharedAccount.awsRegion,
  },
});

app.synth();
