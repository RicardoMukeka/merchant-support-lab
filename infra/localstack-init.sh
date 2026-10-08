#!/bin/sh
# Cria a fila principal com DLQ (redrive): após 3 recebimentos sem delete, a mensagem vai para a DLQ.
awslocal sqs create-queue --queue-name lab-messages-dlq
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/lab-messages-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
awslocal sqs create-queue --queue-name lab-messages --attributes \
  "{\"VisibilityTimeout\":\"30\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"
