# About
This document describes the AuthN/AuthZ mechanisms in communication between GHE and a "Builder" account.

# Connector overview
To setup connectivity we use [GHE AWS connector](https://docs.aws.amazon.com/dtconsole/latest/userguide/connections-create-gheserver-console.html). 
This connector creates GitHub Application in GHE and corresponding AWS Codestar host to listen to GHE webhooks and run application logic. 
Every GHE->AWS connection has to be approved by GHE organization owner/administrator. 
Every connection has per-repository permissions. 
It's possible to change or revoke repository permissions, 
GitHub application permissions from GitHub application administration backend. 

# GitHub application creation process
GHE-AWS connector creates GitHub application using [manifest flow](https://docs.github.com/en/developers/apps/building-github-apps/creating-a-github-app-from-a-manifest) 
with following defaults:
```
{
    "callback_url": "https://redirect.codestar.aws/return",
    "default_events": [
        "issues",
        "issue_comment",
        "pull_request",
        "pull_request_review_comment",
        "pull_request_review",
        "push"
    ],
    "default_permissions": {
        "contents": "write",
        "issues": "write",
        "members": "read",
        "metadata": "read",
        "pull_requests": "write"
    },
    "description": "AWS Resource: arn:aws:codestar-connections:us-east-1:<AWS_ACCOUNT_ID>:host/<CODESTAR_HOST_ID>",
    "hook_attributes": {
        "url": "https://us-east-1.codestar-connections.webhooks.aws/connect/trigger/GitHubEnterpriseServer/?hostArn=<CODESTAR_HOST_ARN>"
    },
    "name": "AWS",
    "public": true,
    "redirect_url": "https://redirect.codestar.aws/return",
    "setup_on_update": true,
    "setup_url": "https://redirect.codestar.aws/return",
    "url": "https://aws.amazon.com"
}
```
> The GitHub App Manifest flow uses a handshaking process similar to the OAuth flow. The flow uses a manifest to register a GitHub App and receives a temporary code used to retrieve the app's private key, webhook secret, and ID.

It is important to note that all long-lived credentials (private key, webhook secret) get stored in AWS Codestar side without any access to them from AWS account. AWS account access only allows deletion of the host. There's no access to the host itself, it's represented just by an ARN.

# Communication between GHE and AWS

## Webhooks from GHE to AWS
Github application signs the webhook data with the webhook secret and AWS codestar verifies the signature upon request.

The data which is "pushed" from GHE to AWS codestar are following GitHub events:
- [Issue comment](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#issue_comment)
- [Issues](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#issues)
- [Pull request](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request)
- [Pull request review](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review)
- [Pull request review comment](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review_comment)
- [Push](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#push)

## Requests from AWS to GHE
AWS part of GithHub application uses private key to generate a JWT token to [authenticate as GitHub app and recieve the "installation token"](https://docs.github.com/en/developers/apps/building-github-apps/authenticating-with-github-apps). 
After that application would get a short-lived access token to access GitHub APIs and pull the code.

The data which is "pulled" from GHE by AWS codestar is the source code.

## Flow diagram
![Communication between GHE and AWS](./resources/ghe-aws.png?raw=true "Communication between GHE and AWS")