import type { MemoryPipeline } from "../pipeline/MemoryPipeline";
import type { MemoryProcessingOptions } from "../pipeline/MemoryPipeline";
import type { SessionInput } from "../types/SessionInput";
import type { IngestionRequest } from "./IngestionRequest";
import { validateIngestionRequest } from "./IngestionRequest";
import { mapPipelineResult, type IngestionResult } from "./IngestionResult";

export interface IngestionServiceOptions {
  pipeline: MemoryPipeline;
}

export class IngestionService {
  private readonly pipeline: MemoryPipeline;

  constructor(options: IngestionServiceOptions) {
    this.pipeline = options.pipeline;
  }

  async ingest(request: IngestionRequest, options: MemoryProcessingOptions = {}): Promise<IngestionResult> {
    validateIngestionRequest(request);

    const sessionInput: SessionInput = {
      projectId: request.projectId
    };
    if (request.transcript) {
      sessionInput.transcript = request.transcript;
    }
    if (request.summary) {
      sessionInput.summary = request.summary;
    }
    if (request.tool) {
      sessionInput.tool = request.tool;
    }
    if (request.sessionId) {
      sessionInput.sessionId = request.sessionId;
    }
    if (request.metadata) {
      sessionInput.metadata = request.metadata;
    }

    const result = await this.pipeline.process(sessionInput, options);
    return mapPipelineResult(result);
  }
}
