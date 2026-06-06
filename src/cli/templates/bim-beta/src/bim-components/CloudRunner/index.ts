import * as OBC from "@thatopen-platform/components-beta";
import { AppManager } from "@thatopen/services";
import { CloudRunnerStatus } from "./src";

export class CloudRunner extends OBC.Component {
  static readonly uuid = "7c4e5d3b-2a1f-4e8d-9b6c-0a3f7e2c5d1b" as const;

  enabled = true;

  readonly onExecutionUpdated = new OBC.Event<CloudRunnerStatus>();

  // TODO: Replace with your actual component ID after publishing.
  componentId = "your-component-id";
  localServerUrl = "http://localhost:4001";

  // Reactive state — read by the UI template on each render.
  status = "Idle";
  progress = 0;
  messages: string[] = [];

  constructor(components: OBC.Components) {
    super(components);
    components.add(CloudRunner.uuid, this);
  }

  async run(useLocal: boolean) {
    // Resolve client at call time via AppManager — never store it as a field.
    const app = this.components.get(AppManager);
    const client = app.client;

    client.localServerUrl = useLocal ? this.localServerUrl : null;

    this.status = useLocal ? "Starting (local)..." : "Starting (deployed)...";
    this.progress = 0;
    this.messages = [];
    this._trigger();

    try {
      const { executionId } = await client.executeComponent(this.componentId, {
        greeting: "Hello from the BIM app!",
      });

      this.status = `Running (${executionId.slice(0, 8)}...)`;
      this._trigger();

      // Subscribe to real-time progress updates via WebSocket.
      client.onExecutionProgress(executionId, (data) => {
        if (data.progressUpdate) {
          this.progress = data.progressUpdate.progress;
          if (data.progressUpdate.result) {
            this.status = `${data.progressUpdate.result}: ${data.progressUpdate.resultMessage ?? "Done"}`;
          }
        }
        if (data.messageUpdate) {
          this.messages.push(data.messageUpdate.content);
        }
        this._trigger();
      });

      // Poll once after a short delay to catch fast executions that complete
      // before the WebSocket subscription is established.
      setTimeout(async () => {
        try {
          const exec = await client.getExecution(executionId);
          if (exec.result) {
            this.progress = exec.progress;
            this.status = `${exec.result}: ${exec.resultMessage ?? "Done"}`;
            this._trigger();
          }
        } catch {
          /* WebSocket handles it */
        }
      }, 2000);
    } catch (err) {
      this.status = `Error: ${err}`;
      this._trigger();
    } finally {
      client.localServerUrl = null;
    }
  }

  private _trigger() {
    this.onExecutionUpdated.trigger({
      status: this.status,
      progress: this.progress,
      messages: [...this.messages],
    });
  }
}

export * from "./src";
