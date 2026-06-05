/*
 * /staff/assistant?session=…&project=… — the engineer's AI Project
 * Assistant in its OWN TAB (the inline panels were removed from the
 * session screens). Renders the EXISTING ProjectAIAssistant component
 * full-window; project context = the CUSTOMER-selected project carried in
 * the query (from the match payload), never an engineer choice.
 */

import { Suspense } from "react";
import { AssistantTabClient } from "./AssistantTabClient";

export default function AssistantTabPage() {
  return (
    <Suspense fallback={null}>
      <AssistantTabClient />
    </Suspense>
  );
}
