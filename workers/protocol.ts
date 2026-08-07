// -- Isolated world to worker message protocol ------------------------------

export interface LoadCommand {
  type: "load";
  ortBaseUrl: string;
}

export interface WorkerResultMessage {
  type: "result";
  ortLoaded: boolean;
  webgpuSession: boolean;
  hasNavigatorGpu: boolean;
  ortError: string | null;
  webgpuError: string | null;
}

export function isLoadCommand(data: unknown): data is LoadCommand {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "load" &&
    typeof (data as { ortBaseUrl?: unknown }).ortBaseUrl === "string"
  );
}

export function isWorkerResultMessage(data: unknown): data is WorkerResultMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "result";
}
