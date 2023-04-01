import { StackProps } from "aws-cdk-lib";

/**
 * Every OU is expected to have following accounts:
 * Dev - account for integration tests
 * Prod - Production
 * Shared - Account for Network connectivity and CICD
 */
export interface OuProps extends StackProps {
  ouName: string;
  devAccount: AccountInfo;
  prodAccount: AccountInfo;
  sharedAccount: AccountInfo;
}

export interface AccountInfo {
  accountId: string;
  awsRegion: string;
  vpcCIDR: string;
}
