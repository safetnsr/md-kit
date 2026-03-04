import { watch, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import type { MdPipeConfig } from './config.js';
import { parseMarkdownFile, evaluateTrigger, type MatchResult, type FileState } from './matcher.js';
import { executeAction, type RunResult } from './runner.js';
import { executePipeline, type PipelineResult } from './pipeline.js';

export interface WatcherEvents {
  match: (result: MatchResult) => void;
  action: (result: RunResult) => void;
  pipeline: (result: PipelineResult) => void;
  error: (error: Error, filePath?: string) => void;
  ready: () => void;
}

export class MdPipeWatcher extends EventEmitter {
  private config: MdPipeConfig;
  private fsWatcher: ReturnType<typeof watch> | null = null;
  private frontmatterCache: Map<string, Record<string, unknown>> = new Map();
  private dryRun: boolean;
  private debounceMs: number;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(config: MdPipeConfig, dryRun: boolean = false) {
    super();
    this.config = config;
    this.dryRun = dryRun;
    this.debounceMs = config.debounce ?? 200;
  }

  async start(): Promise<void> {
    const watchDir = this.config.watch;

    try {
      this.fsWatcher = watch(watchDir, { recursive: true }, (event, filename) => {
        if (!filename || !filename.endsWith('.md')) return;

        const absPath = resolve(watchDir, filename);
        const relPath = relative(watchDir, absPath);

        // Debounce
        const existing = this.debounceTimers.get(relPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(relPath, setTimeout(() => {
          this.debounceTimers.delete(relPath);
          if (existsSync(absPath)) {
            this.handleFile(relPath);
          }
        }, this.debounceMs));
      });

      this.fsWatcher.on('error', (err: unknown) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });

      // Emit ready immediately (fs.watch doesn't have a ready event like chokidar)
      setImmediate(() => this.emit('ready'));
    } catch (err: any) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }

  private handleFile(relativePath: string): void {
    const absolutePath = resolve(this.config.watch, relativePath);

    let file: FileState;
    try {
      file = parseMarkdownFile(absolutePath, relativePath);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)), absolutePath);
      return;
    }

    const previousFm = this.frontmatterCache.get(relativePath);

    // Run legacy triggers
    for (const trigger of this.config.triggers) {
      const match = evaluateTrigger(trigger, file, previousFm);
      if (match) {
        this.emit('match', match);
        const result = executeAction(match, this.dryRun, this.config.configDir);
        this.emit('action', result);
      }
    }

    // Run pipelines
    for (const pipeline of this.config.pipelines) {
      const triggerDef = { name: pipeline.name, match: pipeline.trigger, run: '' };
      const match = evaluateTrigger(triggerDef, file, previousFm);
      if (match) {
        this.emit('match', match);
        executePipeline(pipeline, match, this.config.configDir, this.dryRun)
          .then(result => this.emit('pipeline', result))
          .catch(err => this.emit('error', err instanceof Error ? err : new Error(String(err)), absolutePath));
      }
    }

    // Cache frontmatter for diff tracking
    this.frontmatterCache.set(relativePath, { ...file.frontmatter });
  }
}
