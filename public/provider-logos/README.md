# Provider logos

Drop the official SVG for each provider here and the model picker picks it up
automatically. No code change needed.

| File            | Provider          | Official brand assets                        |
|-----------------|-------------------|----------------------------------------------|
| `openai.svg`    | ChatGPT / OpenAI  | https://openai.com/brand                      |
| `anthropic.svg` | Claude / Anthropic| https://www.anthropic.com/ (brand resources)  |
| `google.svg`    | Gemini / Google   | https://about.google/brand-resource-center/   |
| `xai.svg`       | Grok / xAI        | https://x.ai/                                 |

Until a file exists, the picker falls back to a neutral monogram, so the menu
looks finished either way and nothing 404s.

## Before you add them

These are the vendors' trademarks, not ours. Using a logo to identify that
company's product in a picker is normally fine (nominative use), but each
vendor's brand guidelines set the rules on clear space, recolouring and
minimum size — read the page above before shipping. Do not restyle a mark to
match the site theme; use it as published.

SVG is preferred, but `.png` and `.webp` also work - the server reports whatever
filename it finds and the picker uses it. Square artwork works best; it renders
at 20x20 in the picker.
