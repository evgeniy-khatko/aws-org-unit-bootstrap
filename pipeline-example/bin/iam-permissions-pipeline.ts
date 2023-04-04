#!/usr/bin/env node
import 'source-map-support/register';
import { PipelineStack } from '../lib/pipeline-stack';
import {App} from "aws-cdk-lib";

const app = new App();

const awsRegion = process.env.AWS_REGION || "us-west-2";

new PipelineStack(app, "IamPermissionsPipelineStack", {
    accountPrincipalForAssumingRoles: process.env.CREDENTIALS_ACCOUNT_ID || "662350212343",
    devAccountInfo: {
        accountId: process.env.DEV_ACCOUNT_ID || "231845954509",
        awsRegion
    },
    prodAccountInfo: {
        accountId: process.env.PROD_ACCOUNT_ID || "883656225249",
        awsRegion
    },
    env: {
        region: awsRegion,
        account: process.env.SHARED_ACCOUNT_ID || "006142436528",
    }
});

app.synth();