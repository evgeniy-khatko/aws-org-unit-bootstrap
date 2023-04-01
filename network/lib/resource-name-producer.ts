import { Stack } from "aws-cdk-lib";

export class ResourceNameProducer {
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  produceFromParams(
    humanName: string,
    accountId: string,
    awsRegion: string
  ): string {
    return `${this.prefix}-${accountId}-${awsRegion}-${humanName}`;
  }

  produceFromStack(humanName: string, stack: Stack): string {
    return this.produceFromParams(humanName, stack.account, stack.region);
  }
}
