import { Component } from '@angular/core';

interface Step {
  n: string;
  title: string;
  body: string;
  file: string;
  code: string;
}

// Snippets are taken from orders-serverless/src (trimmed for the page)
const STEPS: Step[] = [
  {
    n: '01',
    title: 'The API accepts, publishes, and returns 202',
    body: 'Orders.Api runs as a Lambda behind API Gateway. It does no slow work: it wraps the request in an OrderCreated event, publishes it to SNS and answers 202 Accepted straight away.',
    file: 'Orders.Api/Program.cs',
    code: `var order = new OrderCreated(Guid.NewGuid(),
    request.CustomerEmail, request.Total, DateTime.UtcNow);
await sns.PublishAsync(topicArn, JsonSerializer.Serialize(order));

// 202 Accepted: the order is queued, not processed yet
return Results.Accepted($"/orders/{order.OrderId}",
    new { order.OrderId });`,
  },
  {
    n: '02',
    title: 'SNS fans the event out to subscribers',
    body: 'The topic has one subscriber today, the queue. Adding email or analytics later means adding a subscription, with no change to the API. Raw delivery puts the JSON straight into the SQS message body.',
    file: 'Orders.AppHost/orders.template.json',
    code: `"OrdersSubscription": {
  "Type": "AWS::SNS::Subscription",
  "Properties": {
    "TopicArn": { "Ref": "OrdersTopic" },
    "Protocol": "sqs",
    "Endpoint": { "Fn::GetAtt": ["OrdersQueue", "Arn"] },
    "RawMessageDelivery": true
  }
}`,
  },
  {
    n: '03',
    title: 'SQS buffers messages and retries failures',
    body: 'A received message is hidden for the visibility timeout. If the consumer does not delete it in time, it reappears and is delivered again. After maxReceiveCount receives it moves to the dead-letter queue so one bad message cannot block the rest.',
    file: 'Orders.AppHost/orders.template.json',
    code: `"OrdersQueue": {
  "Type": "AWS::SQS::Queue",
  "Properties": {
    "RedrivePolicy": {
      "deadLetterTargetArn": { "Fn::GetAtt":
        ["OrdersDeadLetterQueue", "Arn"] },
      "maxReceiveCount": 3
    }
  }
}`,
  },
  {
    n: '04',
    title: 'Lambda processes a batch and reports partial failures',
    body: 'The event source mapping polls the queue and invokes Orders.Processor with up to a batch of records. Records that throw are returned as BatchItemFailures: only those go back to the queue, and the successful ones are deleted.',
    file: 'Orders.Processor/Functions.cs',
    code: `foreach (var message in sqsEvent.Records)
{
    try { /* deserialize OrderCreated, process it */ }
    catch (Exception ex)
    {
        failures.Add(new SQSBatchResponse.BatchItemFailure
            { ItemIdentifier = message.MessageId });
    }
}
// Only the failed messages go back to the queue to be retried
return new SQSBatchResponse(failures);`,
  },
];

@Component({
  selector: 'app-explainer',
  template: `
    <div class="grid">
      @for (s of steps; track s.n) {
        <article class="card step">
          <span class="pill pill-soft">{{ s.n }}</span>
          <h3 class="heading-lg">{{ s.title }}</h3>
          <p class="mute">{{ s.body }}</p>
          <div class="snippet">
            <div class="file micro">{{ s.file }}</div>
            <pre class="code-block">{{ s.code }}</pre>
          </div>
        </article>
      }
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-xl); }
    .step { display: flex; flex-direction: column; gap: var(--space-md); align-items: flex-start; }
    .step p { font-size: 15px; }
    .snippet { width: 100%; margin-top: auto; padding-top: var(--space-sm); }
    .file { color: var(--ink-mute); font-family: var(--font-mono); margin-bottom: var(--space-xs); }
    .code-block { font-size: 12.5px; }
    @media (max-width: 1023px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class Explainer {
  protected readonly steps = STEPS;
}
