# About

This repository bootstraps Organizational Unit (OU) network connections through Transit Gateways (TGW) and sets up integration between Company's GitHub Enterprise server and AWS CodePipelines.

### This infrastructure assumes following AWS accounts hierarchy
- **Host AWS account** owned by Company's administrators outside of OU. The host network is expected to
  - provide connection to Github Enterprise server
  - provide TGW to connect OU to
  - ensure correct IP spaces allocation to avoid overlaps between OUs and On-premises networks
- **Shared AWS account** to manage OU's shared infrastructure: CICD, TGW connection to the Host network
- **Dev AWS account** for non-production workloads
- Prod AWS account for production workloads

### This infrastructure deployes following components
- **Shared TGW** to connect Dev, Prod, Shared accounts with Host network
- **VPCs** in Shared, Dev, Prod accounts with
  - Public, Private, Isolated subnets spread across configurable number of availability zones
    - Public subnets with an Internet Gateway
    - Private subnets with routes to Shared TGW and subsequently to Host network through peering connection
      - when FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK=true -- all traffic in Shared/Prod/Dev private subnets goes to the Host network
      - when FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK=false -- only traffic with Host network CIDR in Shared/Prod/Dev private subnets goes to the Host network. Internet traffic goes to internet through Shared/Prod/Dev NATs
    - Isolated subnets with no routes or connections for Databases etc.
  - Each subnet additionally gets S3 and DynamoDB VPC endpoints
- **Codestar connection to GitHub enterprise** through an AWS-GitHub Enterprise Codestar connector

# Network flow diagram
In many companies there's a requirement to administer all outbound traffic on enterprise level. Hence, this inrastructure provides two options:
- Let OU control the outbound traffic and be accountable for its sanity (`FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK=false`)
  ![Self-managed](./resources/network-flows-self-management.png?raw=true "network-flow-self-managed")
- Route all outbound traffic through the Host network administered on enterprise level (`FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK=true`)
  ![Host-managed](./resources/network-flows-host-management.png?raw=true "network-flow-host-managed")

# Deployment algorithm

## Managing AWS credentials

Steps in the algorithm below require `aws-vault` CLI tool to manage AWS credentials.

### Setup aws-vault

1. https://github.com/99designs/aws-vault/blob/master/USAGE.md
2. Configure your ~/.aws/config with appropriate profiles. For example:

```
[profile shared-admin]
region=us-west-2
role_arn=arn:aws:iam::ACCOUNT_ID:role/OrganizationAccountAccessRole
```

Add profiles to other accounts. We'll need admin access to all the OU AWS accounts.
We'll assume following profiles to be available:

```
shared-admin
prod-admin
dev-admin
```

## Setup environment

Both steps below will depend on environment variable we set up in this step

```
# OU_NAME will be used as a prefix to infrastructure component names
export OU_NAME=geekle
# AWS region where to deploy this infrastructure
export AWS_REGION=us-west-2

# This infrastructure promotes specific Organization account relationships. See "root" README for details
export SHARED_ACCOUNT_ID=006142436528
export PROD_ACCOUNT_ID=883656225249
export DEV_ACCOUNT_ID=231845954509

# Following parameter specified whether to use "host" network to control outbound traffic or let OU control 
# outbound traffic through their own NAT gateways
# When choosing FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK=true make sure host network has routes in public subnet and in TGW
# to route internet traffic to TGW attachment for this OU.
# Indirectly this also means that Host network administrators will have to manage CIDR blocks for each OU connected to their TGW.
export FORCE_OUTBOUND_TRAFFIC_THOUGH_HOST_NETWORK=true

# Github Enterprise server is expected to run inside the host network. Following parameters are specific to its setup
export GITHUB_ORG_NAMES="geekle-ghe-org"
export GITHUB_ENDPOINT="https://gghe.duckdns.org"
# Only if your GitHub Enterprise runs under a self-signed certificate
# export GITHUB_TLS_CERT_FILE="/tmp/ghe.pem"
```

## Bootstrap CDK with correct cross-account permissions
```shell
aws-vault exec shared-admin -- npx cdk bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $SHARED_ACCOUNT_ID aws://$SHARED_ACCOUNT_ID/$AWS_REGION
aws-vault exec dev-admin -- npx cdk bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $SHARED_ACCOUNT_ID aws://$DEV_ACCOUNT_ID/$AWS_REGION
aws-vault exec prod-admin -- npx cdk bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $SHARED_ACCOUNT_ID aws://$PROD_ACCOUNT_ID/$AWS_REGION
```

## Host network connection bootstrap

We need to bootstrap connection to Host network TGW before anything else. Following command will deploy a Shared TWG stack which will create a TGW peering request to connect to Host network.

```shell
aws-vault exec shared-admin -- cdk deploy SharedTgwStack -c attached-to-host=false
```

It will output `SharedTgwRouteTableId` to use in subsequent commands.

**!MANUAL_STEP!** 
- Get attachment approved within host network VPC and wait for state="Available"

## Finish networking setup

When Host network connection approved, we're ready to finish the rest of the setup

```shell
aws-vault exec shared-admin -- cdk deploy SharedTgwStack -c attached-to-host=true --outputs-file /tmp/$OU_NAME
export SHARED_TGW_ID=`cat /tmp/$OU_NAME | awk -F': ' '/SharedTgwId/ {print $2}' | sed 's/[",]//g'`
export SHARED_TGW_RT_ID=`cat /tmp/$OU_NAME | awk -F': ' '/SharedTgwRouteTableId/ {print $2}' | sed 's/[",]//g'`

aws-vault exec shared-admin -- cdk deploy SharedVpcStack --outputs-file /tmp/$OU_NAME
export SHARED_VPC_ID=`cat /tmp/$OU_NAME | awk -F': ' '/VpcId/ {print $2}' | sed 's/[",]//g'`
aws-vault exec dev-admin -- cdk deploy DevVpcStack
aws-vault exec prod-admin -- cdk deploy ProdVpcStack
```

## Establish GitHub enterprise server (GHE) connections

```shell
aws-vault exec shared-admin -- cdk deploy GheConnectionStack
```

This step will deploy infrastructure with Codestar connection which will be used to connect GHE to your Shared account, 
where all the pipelines are supposed to be in.

**!MANUAL_STEP!**
- Click-ops through GitHubEnterprise connection to establish GHE-AWS "handshake".

### Click-ops the connection

Login to AWS console into your Shared account and open codestar URL connection from previous step.
Start process by clicking on "Update Pending connection". Create and install new GitHub application into your GHE.

Once everything is done, capture the `CdstrConnToGHEFor_<GITHUB_ORG_NAME>` stack output which contains codestar connection ARN. 
Using this connection ARN you can now setup CDK pipelines and GitHub commits will trigger these pipelines' executions.

# Contribution
Welcomed!