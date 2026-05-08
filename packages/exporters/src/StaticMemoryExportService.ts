import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { MemoryEntry } from "@openmembrain/core";
import { AgentsMdExporter } from "./AgentsMdExporter";
import { ClaudeMdExporter } from "./ClaudeMdExporter";
import { CopilotInstructionsExporter } from "./CopilotInstructionsExporter";
import { CursorRulesExporter } from "./CursorRulesExporter";
import { ProjectMemoryMdExporter } from "./ProjectMemoryMdExporter";
import type { ExportedMemoryFile, ExportTarget, MemoryExportOptions, MemoryFileExporter } from "./types";

export interface StaticMemoryExportRequest extends MemoryExportOptions {
  projectId: string;
  memories: MemoryEntry[];
  outputDir: string;
  targets?: ExportTarget[];
}

export interface StaticMemoryExportResult {
  projectId: string;
  files: ExportedMemoryFile[];
}

export class StaticMemoryExportService {
  private readonly exporters: MemoryFileExporter[];

  constructor(exporters: MemoryFileExporter[] = defaultExporters()) {
    this.exporters = exporters;
  }

  preview(
    projectId: string,
    memories: MemoryEntry[],
    options: MemoryExportOptions & { targets?: ExportTarget[] } = {}
  ): StaticMemoryExportResult {
    const exporters = this.selectExporters(options.targets);
    const files = exporters.map((exporter) => exporter.export(projectId, memories, options));
    return {
      projectId,
      files
    };
  }

  async write(request: StaticMemoryExportRequest): Promise<StaticMemoryExportResult> {
    const result = this.preview(request.projectId, request.memories, request);

    for (const file of result.files) {
      const absolutePath = join(request.outputDir, file.path);
      assertInsideDirectory(request.outputDir, absolutePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content, "utf8");
    }

    return result;
  }

  private selectExporters(targets: ExportTarget[] | undefined): MemoryFileExporter[] {
    if (!targets || targets.length === 0) {
      return this.exporters;
    }

    const targetSet = new Set(targets);
    return this.exporters.filter((exporter) => targetSet.has(exporter.target));
  }
}

export function defaultExporters(): MemoryFileExporter[] {
  return [
    new AgentsMdExporter(),
    new ClaudeMdExporter(),
    new CopilotInstructionsExporter(),
    new CursorRulesExporter(),
    new ProjectMemoryMdExporter()
  ];
}

function assertInsideDirectory(rootDir: string, targetPath: string): void {
  const root = normalize(rootDir);
  const target = normalize(targetPath);
  if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
    throw new Error(`Refusing to write outside export directory: ${targetPath}`);
  }
}
