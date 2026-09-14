# Level 1: choose the readiness contract

The level follows Manuel de la Peña's
[Understanding Testcontainers: The Wait Strategy Taxonomy](https://mdelapenya.xyz/posts/2026-06-15-understanding-testcontainers-wait-strategies/).
It uses Go API names consistently. A network listener is a useful baseline;
application checks must match what the particular test needs. Logs can support
a port check in a composite, or serve as a fallback for a process with no usable
probe. They are not the default answer for every database.

## Scenarios

Each round shows the test's requirements and four relevant choices. The offered
checks and their number keys change between scenarios, including touch controls.

| Setup | Recommended choice | Lesson |
| --- | --- | --- |
| Postgres with two required startup signals | `wait.ForAll(portWait, logWait)` | Require both the listener and the expected log occurrence count. |
| Fresh Redis, connection-only test | `wait.ForListeningPort("6379/tcp")` | A port check is sufficient for this stated contract. |
| Nginx proxy waiting for its upstream | `wait.ForHTTP("/ready")` | Check the application response the test needs. |
| Keycloak with health endpoints enabled | `wait.ForHTTP("/health/ready").WithPort("9000/tcp")` | An HTTP readiness endpoint and Docker HEALTHCHECK are different things. |
| Kafka broker metadata checked inside the container | `wait.ForExec(metadataCommand)` | A command must exercise the required operation, not simply succeed. |
| MySQL database queried through its mapped port | `wait.ForSQL("3306/tcp", "mysql", dbURL)` | Validate the actual client connection and SQL query. |
| Custom Nginx image with a meaningful Docker HEALTHCHECK | `wait.ForHealthCheck()` | Reuse an existing configured probe. |

These are explicit teaching setups with simulated timings. They do not describe
every startup of those image tags or assert the modules' default configuration.
`demo/nginx-health:1` is a fictional custom image, not an image to pull.
The game does not start containers or execute the snippets.

In the Postgres example, `portWait` represents `wait.ForListeningPort("5432/tcp")`
and `logWait` represents `wait.ForLog(line).WithOccurrence(2)`, where `line` is the
expected startup message. Combining logs with a port probe still requires
maintaining the log pattern as image versions change; prefer the module's
maintained configuration to replacing it with a bare log check.

For Kafka, `metadataCommand` is
`[]string{"kafka-broker-api-versions", "--bootstrap-server", "localhost:9092"}`.
This checks an internal broker request. A host client also needs working mapped
ports and advertised listeners. `dbURL` is the driver's DSN builder for the
mapped host and port, with the test database and credentials configured.

## Feedback and scoring

- Early checks fail and cost a life; unsupported probes time out.
- Checks satisfying the contract earn green points, reduced for unnecessary delay.
- A standalone log that happens to pass in the Redis or MySQL scenario earns
  only 50 points and displays **Passed, but fragile**. It does not cost a life.
- Fixed delays remain timing guesses, with slow or failing outcomes in these setups.
- The startup log panel is observational: matching text is highlighted in amber,
  not presented as proof of readiness. Successful probes reflect the chosen
  check's completion time; missing healthchecks cannot turn green.

## Implementation references

- [Listening-port checks](https://golang.testcontainers.org/features/wait/host_port/)
- [HTTP](https://golang.testcontainers.org/features/wait/http/),
  [SQL](https://golang.testcontainers.org/features/wait/sql/),
  [Exec](https://golang.testcontainers.org/features/wait/exec/),
  [Health](https://golang.testcontainers.org/features/wait/health/)
- [Log](https://golang.testcontainers.org/features/wait/log/) and
  [All](https://golang.testcontainers.org/features/wait/all/)
- [Keycloak health endpoints](https://www.keycloak.org/observability/health)
