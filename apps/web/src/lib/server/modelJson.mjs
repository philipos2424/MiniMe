/**
 * Parse JSON a model returned, tolerating the wrappers models add even when
 * asked for json_object: ```json fences and prose around the object.
 * Onboarding "offerings" failed on every sign-up this way ("Unexpected token '`'")
 * and silently fell back to generic choices.
 */
export function parseModelJson(text) {
  const s = String(text ?? '').trim();
  try { return JSON.parse(s); } catch { /* try the unwrapped forms */ }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /* keep going */ } }
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new SyntaxError('no JSON object in model output');
}
