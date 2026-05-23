"use client";

/*
 * The Try Relay wizard. Mounts inside <TryRelayProvider> when
 * isOpen is true. Three questions → loading → match → /login.
 *
 * State is local via useReducer. Persists across modal close/reopen
 * within the same browser session (the provider stays mounted). Resets
 * on page reload. No localStorage.
 */

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { useTryRelay } from "../TryRelayProvider";
import {
  pickEngineer,
  type Engineer,
  type Need,
  type Timeline,
} from "./data";
import {
  StepFinding,
  StepMatch,
  StepNeed,
  StepStack,
  StepTimeline,
} from "./steps";

type Step = "need" | "stack" | "timeline" | "finding" | "match";

type State = {
  step: Step;
  need: Need | null;
  aiTool: string | null;
  backend: string[];
  frontend: string[];
  timeline: Timeline | null;
  match: Engineer | null;
};

const INITIAL: State = {
  step: "need",
  need: null,
  aiTool: null,
  backend: [],
  frontend: [],
  timeline: null,
  match: null,
};

type Action =
  | { type: "SELECT_NEED"; need: Need }
  | { type: "SELECT_AI"; value: string }
  | { type: "TOGGLE_BACKEND"; value: string }
  | { type: "TOGGLE_FRONTEND"; value: string }
  | { type: "SELECT_TIMELINE"; timeline: Timeline }
  | { type: "GOTO"; step: Step }
  | { type: "MATCH_FOUND"; engineer: Engineer };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SELECT_NEED":
      return { ...state, need: action.need };
    case "SELECT_AI":
      // Single-select within the AI tool group. Re-clicking the
      // current value deselects (lets the user un-pick if they hit
      // the wrong chip).
      return {
        ...state,
        aiTool: state.aiTool === action.value ? null : action.value,
      };
    case "TOGGLE_BACKEND":
      return {
        ...state,
        backend: toggle(state.backend, action.value),
      };
    case "TOGGLE_FRONTEND":
      return {
        ...state,
        frontend: toggle(state.frontend, action.value),
      };
    case "SELECT_TIMELINE":
      return { ...state, timeline: action.timeline };
    case "GOTO":
      return { ...state, step: action.step };
    case "MATCH_FOUND":
      return { ...state, step: "match", match: action.engineer };
    default:
      return state;
  }
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function TryRelayWizard() {
  const router = useRouter();
  const { close } = useTryRelay();
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // When the user enters the "finding" step, simulate ~1.4s of
  // matching, then auto-advance to the match screen with the picked
  // engineer. We do the pickEngineer call only once per arrival at
  // this step, so a re-render mid-spinner doesn't re-pick.
  useEffect(() => {
    if (state.step !== "finding") return;
    const engineer = pickEngineer({
      need: state.need,
      aiTool: state.aiTool,
      backend: state.backend,
      frontend: state.frontend,
      timeline: state.timeline,
    });
    const t = setTimeout(() => {
      dispatch({ type: "MATCH_FOUND", engineer });
    }, 1400);
    return () => clearTimeout(t);
  }, [
    state.step,
    state.need,
    state.aiTool,
    state.backend,
    state.frontend,
    state.timeline,
  ]);

  function onStart() {
    if (!state.match) return;
    const params = new URLSearchParams({
      engineer: state.match.id,
      need: state.need ?? "",
      timeline: state.timeline ?? "",
      ai: state.aiTool ?? "",
    });
    close();
    router.push(`/login?${params.toString()}`);
  }

  return (
    <div
      className="mk-root mk-root-modal-backdrop r-tw-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tryrelay-wizard-title"
      onClick={close}
    >
      <div
        className="r-tw-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="r-tw-close"
          aria-label="Close"
          onClick={close}
        >
          ×
        </button>

        {state.step === "need" && (
          <StepNeed
            selected={state.need}
            onSelect={(need) => dispatch({ type: "SELECT_NEED", need })}
            onContinue={() => dispatch({ type: "GOTO", step: "stack" })}
          />
        )}

        {state.step === "stack" && (
          <StepStack
            stack={{
              aiTool: state.aiTool,
              backend: state.backend,
              frontend: state.frontend,
            }}
            onSelectAi={(value) =>
              dispatch({ type: "SELECT_AI", value })
            }
            onToggleBackend={(value) =>
              dispatch({ type: "TOGGLE_BACKEND", value })
            }
            onToggleFrontend={(value) =>
              dispatch({ type: "TOGGLE_FRONTEND", value })
            }
            onBack={() => dispatch({ type: "GOTO", step: "need" })}
            onContinue={() => dispatch({ type: "GOTO", step: "timeline" })}
          />
        )}

        {state.step === "timeline" && (
          <StepTimeline
            selected={state.timeline}
            onSelect={(timeline) =>
              dispatch({ type: "SELECT_TIMELINE", timeline })
            }
            onBack={() => dispatch({ type: "GOTO", step: "stack" })}
            onFind={() => dispatch({ type: "GOTO", step: "finding" })}
          />
        )}

        {state.step === "finding" && (
          <StepFinding
            snapshot={{
              need: state.need,
              aiTool: state.aiTool,
              backend: state.backend,
              frontend: state.frontend,
              timeline: state.timeline,
            }}
          />
        )}

        {state.step === "match" && state.match && (
          <StepMatch engineer={state.match} onStart={onStart} />
        )}
      </div>
    </div>
  );
}
