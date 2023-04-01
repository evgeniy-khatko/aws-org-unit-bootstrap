export interface HostNetworkInfo {
  accountId: string;
  tgwId: string;
  tgwCIDR: string;
  tgwRegion: string;
}

/**
 * Details to connect to Host VPCs. Should be the same for each OU.
 */
export const HostNetworkInfoMap = {
  US_WEST_2: {
    accountId: "662350212343",
    tgwId: "tgw-0c488e5cbd4d589e5",
    tgwCIDR: "172.16.0.0/24",
    tgwRegion: "us-west-2",
  },
};

/**
 * Getter for HostNetworkInfo. Should be extended to return based on parameters.
 */
export const getHostNetworkInfo = (): HostNetworkInfo => {
  return HostNetworkInfoMap.US_WEST_2;
};
