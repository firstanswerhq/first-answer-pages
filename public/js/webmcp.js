// WebMCP script: exposes two page tools to in-browser AI agents.
// Optional progressive enhancement. The plain HTML quote form always works.
// No top-level side effects except the guarded auto-start at the bottom.

/** Wrap text in an MCP-style tool result. */
function textResult(text, isError = false) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) result.isError = true;
  return result;
}

/** Read the listing id and name from the quote form element on the page. */
function readListing(document) {
  const el = document?.querySelector?.('[data-listing-id]') ?? null;
  const id = el?.getAttribute?.('data-listing-id') ?? el?.dataset?.listingId ?? '';
  const name = el?.getAttribute?.('data-listing-name') ?? el?.dataset?.listingName ?? '';
  return { id: String(id || ''), name: String(name || '') };
}

/** Register one tool; supports registerTool(tool) and provideContext({ tools }). */
function addTool(context, tool) {
  if (typeof context.registerTool === 'function') {
    context.registerTool(tool);
  } else if (typeof context.provideContext === 'function') {
    context.provideContext({ tools: [tool] });
  }
}

/**
 * Register the get_listing and request_quote tools when the browser offers
 * a model context. Returns silently when it does not.
 */
export function registerWebMcp({ navigator, document, window, fetch, console } = {}) {
  const context = navigator?.modelContext ?? document?.modelContext;
  if (!context) return;

  const getListing = {
    name: 'get_listing',
    description: 'Get the full details of the business listing on this page: name, phone, hours, services, and service area.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async execute() {
      const { id } = readListing(document);
      if (!id) return textResult('No listing found on this page.', true);
      try {
        const res = await fetch(`/api/listings/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok) return textResult(`Could not load the listing (status ${res.status}).`, true);
        return textResult(JSON.stringify(data));
      } catch {
        return textResult('Could not load the listing.', true);
      }
    }
  };

  const requestQuote = {
    name: 'request_quote',
    description: 'Send a quote request to the business on this page. The user is asked to confirm before anything is sent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Listing id. Always replaced with the id of this page\'s listing.' },
        name: { type: 'string', minLength: 1, maxLength: 100, description: 'Name of the person asking for the quote.' },
        contact: { type: 'string', description: 'Email address or phone number for the reply.' },
        details: { type: 'string', minLength: 1, maxLength: 2000, description: 'What the person needs done.' }
      },
      required: ['name', 'contact', 'details'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, requiresConfirmation: true },
    requiresConfirmation: true,
    async execute(input) {
      const listing = readListing(document);
      if (!listing.id) return textResult('No listing found on this page.', true);
      const args = input && typeof input === 'object' ? input : {};
      const body = {
        id: listing.id,
        name: args.name,
        contact: args.contact,
        details: args.details
      };
      const businessName = listing.name || listing.id;
      const message =
        `Send this quote request to ${businessName}?\n\n` +
        `Name: ${String(body.name ?? '')}\n` +
        `Contact: ${String(body.contact ?? '')}\n` +
        `Message: ${String(body.details ?? '')}`;
      let confirmed = false;
      try {
        confirmed = window.confirm(message) === true;
      } catch {
        confirmed = false;
      }
      if (!confirmed) return textResult('The user declined. No quote request was sent.');
      try {
        const res = await fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (res.ok) {
          return textResult(`Quote request sent to ${businessName}.${data?.quoteId ? ` Reference: ${data.quoteId}.` : ''}`);
        }
        const reason = typeof data?.error === 'string' ? data.error : `status ${res.status}`;
        return textResult(`The quote request was not sent: ${reason}.`, true);
      } catch {
        return textResult('The quote request could not be sent.', true);
      }
    }
  };

  // Separate blocks: one failure must not stop the other or break the page.
  try {
    addTool(context, getListing);
  } catch {
    // Swallowed on purpose.
  }
  try {
    addTool(context, requestQuote);
  } catch {
    // Swallowed on purpose.
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  registerWebMcp({
    navigator: typeof navigator === 'undefined' ? undefined : navigator,
    document,
    window,
    fetch: (...args) => window.fetch(...args),
    console
  });
}
