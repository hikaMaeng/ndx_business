import { parseModelCatalogSnapshot, type SetModelDefaultRequest } from "../../../../common/protocol/models/index.js";
import type { EndpointDraft, ModelDefinitionDraft } from "../drafts/index.js";
import type { ModelsFeatureModel } from "../types.js";

/**
 * How this feature reaches the server. A function, not a wire shape — the name
 * says fetch because that is what it is.
 *
 * Injected rather than imported: the domain must not know how a request is
 * authenticated, only that something can make one. The app supplies its authed
 * fetch and the domain stays free of tokens, headers and base URLs.
 */
export type ModelsFetch = (path: string, options?: RequestInit) => Promise<unknown>;

/** What to say when a request fails without saying anything useful itself. */
export interface CommandText {
  failed: string;
  endpointCreated: string;
  endpointUpdated: string;
  endpointRefreshed: string;
  definitionCreated: string;
  definitionUpdated: string;
  defaultChanged: string;
}

/**
 * Every write to the catalog, and the one shape they all share.
 *
 * These lived inside the screen component as six near-identical async
 * functions, each opening with `setBusy(true); setError("")` and closing with a
 * `finally`. That is not rendering — it is what the feature *does*, and a
 * second surface onto the same catalog would have had to copy all six.
 *
 * Each returns whether it succeeded, so a caller can close a dialog on success
 * without reading the error slice back and guessing.
 */
export class ModelsCommands {
  /**
   * The words arrive as a getter, not a value.
   *
   * A caller that builds its translations by spreading bundles hands over a new
   * object on every render, and if that object decided this instance's identity
   * the caller would rebuild the commands each time — and any effect keyed on
   * them would re-run for ever. Reading the words at call time keeps the
   * instance stable and still current.
   */
  constructor(
    private readonly model: ModelsFeatureModel,
    private readonly request: ModelsFetch,
    private readonly words: () => CommandText,
  ) {}

  /**
   * The server answers every write with the whole catalog, so there is one path
   * in and one place the new truth lands. No optimistic patching, no merging a
   * response into a local copy — the catalog is replaced by what the server
   * says it is.
   */
  private async apply(path: string, options?: RequestInit): Promise<void> {
    const value = parseModelCatalogSnapshot(await this.request(path, options));
    if (!value) throw new Error(this.words().failed);
    this.model.catalog.set(value);
  }

  private async run(path: string, options: RequestInit | undefined, success: string): Promise<boolean> {
    this.model.progress.mutate((current) => { current.busy = true; current.error = ""; });
    try {
      await this.apply(path, options);
      this.model.progress.mutate((current) => { current.status = success; });
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : this.words().failed;
      this.model.progress.mutate((current) => { current.error = message; });
      return false;
    } finally {
      this.model.progress.mutate((current) => { current.busy = false; current.loaded = true; });
    }
  }

  load(): Promise<boolean> {
    return this.run("/api/models", undefined, "");
  }

  createEndpoint(draft: EndpointDraft): Promise<boolean> {
    return this.run("/api/models", { method: "POST", body: JSON.stringify(draft) }, this.words().endpointCreated);
  }

  saveEndpoint(endpointId: string, draft: EndpointDraft): Promise<boolean> {
    return this.run(`/api/models/${endpointId}`, { method: "PUT", body: JSON.stringify(draft) }, this.words().endpointUpdated);
  }

  refreshEndpoint(endpointId: string): Promise<boolean> {
    return this.run(`/api/models/${endpointId}/refresh`, { method: "POST" }, this.words().endpointRefreshed);
  }

  createDefinition(endpointId: string, draft: ModelDefinitionDraft): Promise<boolean> {
    return this.run(`/api/models/${endpointId}/models`, { method: "POST", body: JSON.stringify(draft) }, this.words().definitionCreated);
  }

  saveDefinition(endpointId: string, modelId: string, draft: ModelDefinitionDraft): Promise<boolean> {
    return this.run(`/api/models/${endpointId}/models/${modelId}`, { method: "PUT", body: JSON.stringify(draft) }, this.words().definitionUpdated);
  }

  /**
   * Separate from `saveDefinition` for the same reason the request is separate
   * from the update: a save of a model's sampling must not be able to carry an
   * opinion about the deployment default with it.
   */
  setDefault(endpointId: string, modelId: string, isDefault: boolean): Promise<boolean> {
    return this.run(`/api/models/${endpointId}/models/${modelId}/default`, { method: "PUT", body: JSON.stringify({ isDefault } satisfies SetModelDefaultRequest) }, this.words().defaultChanged);
  }
}
