# Serverless .NET orders: API Gateway → Lambda → SNS → SQS → Lambda

```
client ─► API Gateway ─► Orders.Api (Lambda) ──publish──► SNS topic ──► SQS queue ──trigger──► Orders.Processor (Lambda)
```

| Folder | What | Guide |
|---|---|---|
| [`orders-serverless/`](orders-serverless) | .NET backend: Orders.Api, Orders.Processor, the Aspire AppHost and the CloudFormation template | [how-to-build.md](orders-serverless/how-to-build.md) |
| [`frontend/`](frontend) | Angular visualizer: simulates the pipeline in the browser, or sends real orders to Orders.Api | [how-to-build.md](frontend/how-to-build.md) |
| [`netlify.toml`](netlify.toml) | Builds and hosts the frontend on Netlify | Frontend guide, Step 10a |
| [`.github/workflows/`](.github/workflows) | Deploys the backend's infrastructure and Orders.Api from the `main` branch | Backend guide, Step 7 |

## Run it locally

```bash
# backend: creates the SNS topic and SQS queues in AWS, runs both Lambdas and an API Gateway emulator locally
cd orders-serverless
dotnet run --project src/Orders.AppHost

# frontend, in a second terminal: http://localhost:4200
cd frontend
npm install
cp .env.example .env   # set ORDERS_API_BASE_URL to the APIGatewayEmulator URL from the Aspire dashboard
npm start
```
