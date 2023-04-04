import {Stack, StackProps} from "aws-cdk-lib";
import {Construct} from "constructs";
import {AccountPrincipal, ManagedPolicy, Role} from "aws-cdk-lib/aws-iam";

export interface IamPermissionsStackProps extends StackProps {
    accountPrincipalForAssumingRoles: string,
    roleNameSuffix: string,
}

export class IamPermissionsStack extends Stack {

    constructor(scope: Construct, id: string, props: IamPermissionsStackProps) {
        super(scope, id, props);

        const readOnlyRole = new Role(this, "read-only-iam-role", {
            roleName: `read-only-iam-role-${props.roleNameSuffix}`,
            assumedBy: new AccountPrincipal(props.accountPrincipalForAssumingRoles),
            description: "Provides read only access to resources",
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName(
                    "ReadOnlyAccess",
                ),
            ],
        });
    }
}
