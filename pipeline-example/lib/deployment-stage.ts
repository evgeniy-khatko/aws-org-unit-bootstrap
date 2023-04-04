import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { IamPermissionsStack, IamPermissionsStackProps } from "./iam-permissions-stack";

/**
 * Deployment Stage of your app.
 */
export class DeploymentStage extends Stage {
    constructor(
        scope: Construct,
        id: string,
        iamPermissionsStackProps: IamPermissionsStackProps,
        deploymentProps: StageProps
    ) {
        super(scope, id, deploymentProps);
        new IamPermissionsStack(this, IamPermissionsStack.name, iamPermissionsStackProps);
    }
}
