import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Boxes, Plus, RefreshCw, Save, Star, StarOff, X } from "lucide-react";
import {
  ensureModelsFeatureModel, ModelsCommands, createEndpointDraft, createModelDefinitionDraft,
  type EndpointDraft, type ModelDefinitionDraft,
} from "admin_domain/front";
import {
  type ModelDefinition,
  type ModelEndpoint,
  type ModelEndpointType,
} from "admin_domain/common";
import { Button } from "../components/ui/button";
import { resolveLanguage, texts } from "../i18n";
import { useModel } from "../model/useModel";
import { RSC } from "./resource";
import type { ModelsRequestApi } from "./types";
import "./styles.css";

export type { ModelsRequestApi } from "./types";

// Accepts whatever a command returns: the screen cares that it finished, not
// what it answered.
type EndpointSave = { (draft: EndpointDraft): Promise<unknown> };
const endpointTypes: Array<[ModelEndpointType, RSC]> = [
  ["openai-chat-completion", RSC.MODELS_TYPE_OPENAI_CHAT_COMPLETION_LABEL],
  ["openai-responses", RSC.MODELS_TYPE_OPENAI_RESPONSES_LABEL],
  ["anthropic", RSC.MODELS_TYPE_ANTHROPIC_LABEL],
  ["gemini", RSC.MODELS_TYPE_GEMINI_LABEL],
];

function providerLabel(type: ModelEndpointType, text: Record<string, string>): string {
  return text[endpointTypes.find(([value]) => value === type)![1]];
}

/**
 * Which model the deployment falls back to, stated on both views.
 *
 * The empty case is not "nothing has been configured yet". A deployment with no
 * default cannot open a session for an account that belongs to no organisation,
 * so the screen names that consequence rather than leaving a blank where a
 * model name would be and letting an administrator read it as optional.
 */
function DefaultModelSummary({ model, text }: { model: ModelDefinition | null; text: Record<string, string> }) {
  return (
    <div className="models-default-summary" data-testid="models-default-summary">
      {model ? (
        <p className="models-default-current" data-testid="models-default-current">
          <span className="models-default-badge">{text[RSC.MODELS_MODEL_DEFAULT_BADGE]}</span>
          <strong>{model.identifier}</strong>
        </p>
      ) : (
        <p role="status" className="models-default-none" data-testid="models-default-none">
          {text[RSC.MODELS_MODEL_DEFAULT_NONE_TEXT]}
        </p>
      )}
      <p className="models-default-hint">{text[RSC.MODELS_MODEL_DEFAULT_HINT]}</p>
    </div>
  );
}

function EndpointForm({
  endpoint,
  busy,
  error,
  text,
  onSave,
  onCancel,
}: {
  endpoint?: ModelEndpoint;
  busy: boolean;
  error?: string;
  text: Record<string, string>;
  onSave: EndpointSave;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => createEndpointDraft(endpoint));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await onSave(draft);
  }

  return (
    <form className="models-endpoint-form" onSubmit={submit}>
      <label>
        {text[RSC.MODELS_ENDPOINT_NAME_LABEL]}
        <input
          required
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        {text[RSC.MODELS_ENDPOINT_URL_LABEL]}
        <input
          required
          type="url"
          value={draft.url}
          placeholder={text[RSC.MODELS_ENDPOINT_URL_PLACEHOLDER]}
          onChange={(event) => setDraft({ ...draft, url: event.target.value })}
        />
      </label>
      <div className="models-endpoint-form-grid">
        <label>
          {text[RSC.MODELS_ENDPOINT_HEADER_NAME_LABEL]}
          <input
            value={draft.headerName}
            onChange={(event) => setDraft({ ...draft, headerName: event.target.value })}
          />
        </label>
        <label>
          {text[RSC.MODELS_ENDPOINT_HEADER_VALUE_LABEL]}
          <input
            value={draft.headerValue}
            placeholder={text[RSC.MODELS_ENDPOINT_HEADER_VALUE_PLACEHOLDER]}
            onChange={(event) => setDraft({ ...draft, headerValue: event.target.value })}
          />
        </label>
        <label>
          {text[RSC.MODELS_ENDPOINT_TYPE_LABEL]}
          <select
            value={draft.type}
            onChange={(event) =>
              setDraft({ ...draft, type: event.target.value as ModelEndpointType })
            }
          >
            {endpointTypes.map(([value, key]) => (
              <option key={value} value={value}>
                {text[key]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="models-form-actions">
        <Button type="submit" disabled={busy}>
          <Save aria-hidden="true" />
          {text[RSC.MODELS_ENDPOINT_SAVE_BUTTON]}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X aria-hidden="true" />
          {text[RSC.MODELS_ENDPOINT_CANCEL_BUTTON]}
        </Button>
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
    </form>
  );
}

function ModelDefinitionForm({
  item,
  busy,
  error,
  text,
  onSave,
  onCancel,
}: {
  item?: ModelDefinition;
  busy: boolean;
  error?: string;
  text: Record<string, string>;
  onSave: { (draft: ModelDefinitionDraft): Promise<void> };
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => createModelDefinitionDraft(item));

  return (
    <form
      className="models-definition-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft);
      }}
    >
        <label>
          {text[RSC.MODELS_MODEL_IDENTIFIER_LABEL]}
          <input
            required
            value={draft.identifier}
            onChange={(event) => setDraft({ ...draft, identifier: event.target.value })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_CONTEXT_SIZE_LABEL]}
          <input
            required
            min={0}
            type="number"
            value={draft.contextSize}
            onChange={(event) => setDraft({ ...draft, contextSize: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_TEMPERATURE_LABEL]}
          <input
            step="any"
            type="number"
            value={draft.temperature}
            onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_MIN_P_LABEL]}
          <input
            min={0}
            max={1}
            step="any"
            type="number"
            value={draft.minP}
            onChange={(event) => setDraft({ ...draft, minP: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_TOP_P_LABEL]}
          <input
            min={0}
            max={1}
            step="any"
            type="number"
            value={draft.topP}
            onChange={(event) => setDraft({ ...draft, topP: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_TOP_K_LABEL]}
          <input
            min={0}
            step="1"
            type="number"
            value={draft.topK}
            onChange={(event) => setDraft({ ...draft, topK: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_REPEAT_PENALTY_LABEL]}
          <input
            step="any"
            type="number"
            value={draft.repeatPenalty}
            onChange={(event) => setDraft({ ...draft, repeatPenalty: Number(event.target.value) })}
          />
        </label>
        <label className="models-check-row">
          <input
            type="checkbox"
            checked={draft.reasoning}
            onChange={(event) => setDraft({ ...draft, reasoning: event.target.checked })}
          />
          {text[RSC.MODELS_MODEL_REASONING_LABEL]}
        </label>
        <fieldset>
          <legend>{text[RSC.MODELS_MODEL_MODALITIES_LABEL]}</legend>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsText} onChange={(event) => setDraft({ ...draft, supportsText: event.target.checked })} />
            {text[RSC.MODELS_MODEL_TEXT_LABEL]}
          </label>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsImage} onChange={(event) => setDraft({ ...draft, supportsImage: event.target.checked })} />
            {text[RSC.MODELS_MODEL_IMAGE_LABEL]}
          </label>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsSound} onChange={(event) => setDraft({ ...draft, supportsSound: event.target.checked })} />
            {text[RSC.MODELS_MODEL_SOUND_LABEL]}
          </label>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsVideo} onChange={(event) => setDraft({ ...draft, supportsVideo: event.target.checked })} />
            {text[RSC.MODELS_MODEL_VIDEO_LABEL]}
          </label>
        </fieldset>
        <Button type="submit" disabled={busy}>
          <Save aria-hidden="true" />
          {text[RSC.MODELS_MODEL_SAVE_BUTTON]}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X aria-hidden="true" />
          {text[RSC.MODELS_ENDPOINT_CANCEL_BUTTON]}
        </Button>
        {error && <p role="alert" className="error-text">{error}</p>}
    </form>
  );
}

export function ModelsScreen({ token, request }: { token: string; request: ModelsRequestApi }) {
  const text = texts(resolveLanguage());
  const model = useMemo(() => ensureModelsFeatureModel(token), [token]);
  const catalog = useModel(model.catalog).value;
  const selectedEndpointId = useModel(model.selection).value;
  const progress = useModel(model.progress).value;
  const { busy, loaded, error, status } = progress;

  // Ephemeral, and deliberately not in the model: which dialog is open has no
  // meaning outside this screen and nothing else reads it.
  const [creating, setCreating] = useState(false);
  const [modelDialog, setModelDialog] = useState<ModelDefinition | "create" | null>(null);

  /**
   * The feature's writes, which used to be six near-identical async functions
   * in this component. The screen supplies the authed request and the words for
   * each outcome; what to call, in what order, and what it does to the catalog
   * is the domain's.
   */
  // The words are read through a ref, so re-translating cannot change this
  // instance and re-run the effect below. `texts()` spreads its bundles, so it
  // returns a new object every render — depending on it here spun the load
  // effect for ever and froze the tab.
  const words = useRef(text);
  words.current = text;
  const commands = useMemo(
    () => new ModelsCommands(model, (path, options) => request(path, options, token), () => ({
      failed: words.current[RSC.AUTH_ERROR_ALERT],
      endpointCreated: words.current[RSC.MODELS_ENDPOINT_CREATED_STATUS],
      endpointUpdated: words.current[RSC.MODELS_ENDPOINT_UPDATED_STATUS],
      endpointRefreshed: words.current[RSC.MODELS_ENDPOINT_REFRESH_STATUS],
      definitionCreated: words.current[RSC.MODELS_MODEL_CREATED_STATUS],
      definitionUpdated: words.current[RSC.MODELS_MODEL_UPDATED_STATUS],
      // Moving the default is an update to a model, and the bundles have no
      // sentence of its own for it; the badge that appears next to the model
      // says which one it landed on.
      defaultChanged: words.current[RSC.MODELS_MODEL_UPDATED_STATUS],
    })),
    [model, request, token],
  );

  useEffect(() => { void commands.load(); }, [commands]);

  // Closing a dialog is this screen's business, so it stays here — and it only
  // closes when the command says it worked, which is why they return a verdict.
  const createEndpoint = async (draft: EndpointDraft): Promise<void> => {
    if (await commands.createEndpoint(draft)) setCreating(false);
  };
  const createDefinition = async (endpointId: string, draft: ModelDefinitionDraft): Promise<void> => {
    if (await commands.createDefinition(endpointId, draft)) setModelDialog(null);
  };
  const saveDefinition = async (endpointId: string, modelId: string, draft: ModelDefinitionDraft): Promise<void> => {
    if (await commands.saveDefinition(endpointId, modelId, draft)) setModelDialog(null);
  };
  const saveEndpoint = commands.saveEndpoint.bind(commands);
  const refreshEndpoint = commands.refreshEndpoint.bind(commands);
  const setDefault = commands.setDefault.bind(commands);

  // Searched across the whole catalog rather than the selected endpoint's
  // models, because the default belongs to the deployment: the model holding it
  // may sit under an endpoint the administrator is not currently looking at.
  const defaultModel = catalog.models.find((item) => item.isDefault) ?? null;
  const selectedEndpoint = catalog.endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null;
  const selectedModels = selectedEndpoint
    ? catalog.models.filter((item) => item.endpointId === selectedEndpoint.id)
    : [];

  return (
    <section className="models-panel" aria-busy={!loaded}>
      {selectedEndpoint ? (
        <>
          <div className="page-heading models-detail-heading">
            <div>
              <div className="eyebrow">{text[RSC.MODELS_ENDPOINT_DETAIL_TEXT]}</div>
              <h1>{selectedEndpoint.name}</h1>
            </div>
            <Button variant="outline" onClick={() => model.selection.set(null)} disabled={busy}>
              <ArrowLeft aria-hidden="true" />
              {text[RSC.MODELS_BACK_BUTTON]}
            </Button>
          </div>
          <EndpointForm
            key={selectedEndpoint.id}
            endpoint={selectedEndpoint}
            busy={busy}
            error={error}
            text={text}
            onSave={(draft) => saveEndpoint(selectedEndpoint.id, draft)}
            onCancel={() => model.selection.set(null)}
          />
          <div className="models-list-heading">
            <div>
              <div className="eyebrow">{text[RSC.MODELS_ENDPOINT_MODELS_LABEL]}</div>
              <h2>{selectedEndpoint.name}</h2>
            </div>
            <div className="models-list-actions">
              <Button type="button" onClick={() => setModelDialog("create")} disabled={busy}>
                <Plus aria-hidden="true" />
                {text[RSC.MODELS_MODEL_ADD_BUTTON]}
              </Button>
              <Button type="button" variant="outline" onClick={() => refreshEndpoint(selectedEndpoint.id)} disabled={busy}>
                <RefreshCw aria-hidden="true" />
                {text[RSC.MODELS_ENDPOINT_REFRESH_BUTTON]}
              </Button>
            </div>
          </div>
          <DefaultModelSummary model={defaultModel} text={text} />
          {selectedModels.length === 0 ? (
            <p className="models-empty">{text[RSC.MODELS_ENDPOINT_MODELS_EMPTY_MESSAGE]}</p>
          ) : (
            <div className="models-definitions" role="list" aria-label={text[RSC.MODELS_ENDPOINT_MODELS_LABEL]}>
              {selectedModels.map((item) => (
                // The row is a container, not a control: the default action is a
                // button of its own and cannot be nested inside the button that
                // opens the model for editing.
                <div
                  className="models-definition-row"
                  key={item.id}
                  role="listitem"
                  data-testid="models-definition-row"
                  data-model-identifier={item.identifier}
                  data-model-default={item.isDefault ? "true" : "false"}
                >
                  <button
                    className="models-definition"
                    type="button"
                    onClick={() => setModelDialog(item)}
                    aria-label={item.identifier}
                  >
                    <strong>{item.identifier}</strong>
                    <span className="models-definition-meta">
                      {item.isDefault && (
                        <span className="models-default-badge" data-testid="models-default-badge">
                          {text[RSC.MODELS_MODEL_DEFAULT_BADGE]}
                        </span>
                      )}
                      <span>{item.contextSize.toLocaleString()}</span>
                    </span>
                  </button>
                  {/* One control that reads as what pressing it will do, so the
                      accessible name states the outcome instead of the state. */}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    data-testid={item.isDefault ? "models-default-clear" : "models-default-set"}
                    onClick={() => void setDefault(selectedEndpoint.id, item.id, !item.isDefault)}
                  >
                    {item.isDefault ? <StarOff aria-hidden="true" /> : <Star aria-hidden="true" />}
                    {text[item.isDefault ? RSC.MODELS_MODEL_DEFAULT_CLEAR_BUTTON : RSC.MODELS_MODEL_DEFAULT_SET_BUTTON]}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {modelDialog && (
            <div className="models-dialog-backdrop" role="presentation">
              <section
                className="models-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={text[modelDialog === "create" ? RSC.MODELS_MODEL_ADD_TEXT : RSC.MODELS_MODEL_EDIT_TEXT]}
              >
                <div className="models-dialog-heading">
                  <h2>{text[modelDialog === "create" ? RSC.MODELS_MODEL_ADD_TEXT : RSC.MODELS_MODEL_EDIT_TEXT]}</h2>
                </div>
                <ModelDefinitionForm
                  key={modelDialog === "create" ? "create" : modelDialog.id}
                  item={modelDialog === "create" ? undefined : modelDialog}
                  busy={busy}
                  error={error}
                  text={text}
                  onSave={(draft) => modelDialog === "create"
                    ? createDefinition(selectedEndpoint.id, draft)
                    : saveDefinition(selectedEndpoint.id, modelDialog.id, draft)}
                  onCancel={() => setModelDialog(null)}
                />
              </section>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{text[RSC.ADMIN_BADGE_TEXT]}</div>
              <h1>{text[RSC.MODELS_TITLE_TEXT]}</h1>
              <p>{text[RSC.MODELS_SUBTITLE_TEXT]}</p>
            </div>
            <Button type="button" onClick={() => setCreating(true)} disabled={busy}>
              <Plus aria-hidden="true" />
              {text[RSC.MODELS_ADD_ENDPOINT_BUTTON]}
            </Button>
          </div>
          {creating && (
            <div className="models-dialog-backdrop" role="presentation">
              <section className="models-dialog" role="dialog" aria-modal="true" aria-label={text[RSC.MODELS_ADD_ENDPOINT_BUTTON]}>
                <div className="models-dialog-heading">
                  <h2>{text[RSC.MODELS_ADD_ENDPOINT_BUTTON]}</h2>
                </div>
                <EndpointForm
                  busy={busy}
                  error={error}
                  text={text}
                  onSave={createEndpoint}
                  onCancel={() => setCreating(false)}
                />
              </section>
            </div>
          )}
          {error && !creating && <p role="alert" className="error-text">{error}</p>}
          {status && <p role="status" className="models-status">{status}</p>}
          {/* Held back until the first load has finished: announcing that the
              deployment has no default before the catalog has arrived would be
              a false alarm about sessions that can in fact be opened. */}
          {loaded && <DefaultModelSummary model={defaultModel} text={text} />}
          {!loaded ? (
            <p role="status" className="models-empty">{text[RSC.MODELS_LOADING_STATUS]}</p>
          ) : catalog.endpoints.length === 0 ? (
            <p className="models-empty">{text[RSC.MODELS_EMPTY_MESSAGE]}</p>
          ) : (
            <div className="models-endpoint-grid" aria-label={text[RSC.MODELS_TITLE_TEXT]}>
              {catalog.endpoints.map((endpoint) => {
                const endpointModels = catalog.models.filter((item) => item.endpointId === endpoint.id);
                return (
                  <button
                    className="models-endpoint-card"
                    key={endpoint.id}
                    onClick={() => model.selection.set(endpoint.id)}
                    type="button"
                    aria-label={endpoint.name}
                  >
                    <span className="models-endpoint-card-heading">
                      <Boxes aria-hidden="true" />
                      <strong>{endpoint.name}</strong>
                    </span>
                    <span className="models-endpoint-type">{providerLabel(endpoint.type, text)}</span>
                    <span className="models-endpoint-url">{endpoint.url}</span>
                    <span className="models-endpoint-header">
                      {endpoint.headerName ? (
                        <>
                          <span>{endpoint.headerName}</span>
                          <span>{text[RSC.MODELS_ENDPOINT_HEADER_CONFIGURED_TEXT]}</span>
                        </>
                      ) : text[RSC.MODELS_ENDPOINT_HEADER_NONE_TEXT]}
                    </span>
                    <span className="models-card-divider" aria-hidden="true" />
                    <span className="models-card-list">
                      {endpointModels.map((item) => (
                        <span className="models-card-model" key={item.id}>
                          <span>{item.identifier}</span>
                          <b>{item.contextSize.toLocaleString()}</b>
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {selectedEndpoint && status && <p role="status" className="models-status">{status}</p>}
    </section>
  );
}
