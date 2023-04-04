import { Construct } from 'constructs';
import {Fn, Stack, StackProps} from "aws-cdk-lib";
import {CodeBuildStep, CodePipeline, CodePipelineSource} from "aws-cdk-lib/pipelines";
import {DeploymentStage} from "./deployment-stage";

export interface AccountInfo {
    accountId: string,
    awsRegion: string,
}

export interface IamPermissionsPipelineProps extends StackProps {
    accountPrincipalForAssumingRoles: string,
    devAccountInfo: AccountInfo,
    prodAccountInfo: AccountInfo,
}

/**
 * The stack that defines the application pipeline.
 */
export class PipelineStack extends Stack {
    private static readonly GITHUB_REPOSITORY = "geekle-ghe-org/iam-permissions-pipeline";
    private static readonly GITHUB_BRANCH = "main";
    // Following export name depends on what has been exported as part on Ghe connections stack in
    // https://github.com/evgeniy-khatko/aws-org-unit-bootstrap/blob/main/network/README.md
    private static readonly GHE_CONNECTION_EXPORT_NAME="gheConnectionArn";

    constructor(scope: Construct, id: string, props: IamPermissionsPipelineProps) {
    super(scope, id, props);

    let stages = new Map<string, AccountInfo>([
        ["dev", props.devAccountInfo],
        ["prod", props.prodAccountInfo],
    ]);

    const buildStep = new CodeBuildStep("Build", {
        input: CodePipelineSource.connection(
            PipelineStack.GITHUB_REPOSITORY,
            PipelineStack.GITHUB_BRANCH,
            {
                connectionArn: Fn.importValue(PipelineStack.GHE_CONNECTION_EXPORT_NAME),
                codeBuildCloneOutput: true,
            }
        ),
        commands: [
            "npm install -g typescript",
            "npm install -g ts-node",
            "npm install -g aws-cdk",
            "npm ci",
            "npm run build",
            "npx cdk synth",
        ],
    });

    const pipeline = new CodePipeline(this, PipelineStack.name, {
        pipelineName: "iam-permissions-pipeline",
        crossAccountKeys: true, // To encrypt artifacts in S3 across deployment accounts
        synth: buildStep,
    });

    for (let [stage, accountInfo] of stages.entries()) {
        pipeline.addStage(
            new DeploymentStage(
                this,
                stage,
                {
                    accountPrincipalForAssumingRoles: props.accountPrincipalForAssumingRoles,
                    roleNameSuffix: stage,
                },
                {
                    env: {
                        account: accountInfo.accountId,
                        region: accountInfo.awsRegion,
                    },
                }
            ),
        );
    }
  }
}