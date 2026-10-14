type JsonLdProps = { data: Record<string, unknown> | Record<string, unknown>[] };

/** Renders a single application/ld+json script. No visible UI. */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
