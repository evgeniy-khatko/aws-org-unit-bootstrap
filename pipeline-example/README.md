# About
Example CDK pipeline to manage IAM permissions in our OU.
Deploys following IAM roles into Dev and Prod environments: 
- read-only-iam-role-<stage>

## Bootstrap instructions
As with any pipeline, there should be a one-time CloudFormation stack deployment into Shared account to bootstrap the pipeline.
Later changes to the pipeline will be picked up automatically because CDK pipeline are self-extending.

```shell
# Account which authenticates engineers to AWS. This account should not have any permissions other than being able to assume other roles 
export CREDENTIALS_ACCOUNT_ID="662350212343"
export DEV_ACCOUNT_ID="231845954509"
export PROD_ACCOUNT_ID="883656225249"
# Shared account is where the pipelines live. It has permissions to deploy to other accounts.
export SHARED_ACCOUNT_ID="006142436528"
```

Note:
As part of [network setup](https://github.com/evgeniy-khatko/aws-org-unit-bootstrap/blob/main/network/README.md), we assume that CDK has been bootstrapped in all accounts: Shared/Dev/Prod with correct cross account permissions:
```shell
aws-vault exec shared-admin -- npx cdk bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $SHARED_ACCOUNT_ID aws://$SHARED_ACCOUNT_ID/$AWS_REGION
aws-vault exec dev-admin -- npx cdk bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $SHARED_ACCOUNT_ID aws://$DEV_ACCOUNT_ID/$AWS_REGION
aws-vault exec prod-admin -- npx cdk bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $SHARED_ACCOUNT_ID aws://$PROD_ACCOUNT_ID/$AWS_REGION
```