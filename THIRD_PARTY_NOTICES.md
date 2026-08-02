# Third-party notices

DietDigiDose includes or redistributes the following third-party material. The project-level MIT license does not replace the licenses listed here.

## Project-created AI-generated media

- File: `server/public/community/tofu-seaweed-soup.png`
- Purpose: bundled demonstration image for a seeded community post
- Provenance: generated with OpenAI's image generation service on July 31, 2026

The PNG contains content-provenance metadata identifying `gpt-image` as the software agent, `trainedAlgorithmicMedia` as the digital source type, and OpenAI Media Service as the signer. It was generated for this project rather than copied from a third-party photo library. This entry is included for provenance transparency; the image is not presented as a photograph of a real meal.

## HeroUI Native

- Upstream: <https://github.com/heroui-inc/heroui-native>
- Location: `client/heroui/`
- License: Apache License 2.0
- Copyright: HeroUI contributors

The vendored component source is integrated locally. A copy of the Apache License 2.0 is provided at [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt). Copyright, attribution and license comments already present in individual source files must be retained. Record the upstream revision and mark modified files when updating this directory.

## HowToCook

- Upstream: <https://github.com/Anduin2017/HowToCook>
- Locations: `server/public/recipes/howtocook/` and records imported with `source = howtocook`
- License: The Unlicense
- Copyright: HowToCook contributors

Imported records preserve the upstream source URL, source revision and data license in the database. A copy of the upstream license is provided at [`LICENSES/Unlicense.txt`](LICENSES/Unlicense.txt).

## Space Mono

- Upstream: <https://github.com/googlefonts/spacemono>
- Location: `client/assets/fonts/SpaceMono-Regular.ttf`
- License: SIL Open Font License 1.1
- Copyright: The Space Mono Project Authors

A copy of the SIL Open Font License is provided at [`LICENSES/OFL-1.1.txt`](LICENSES/OFL-1.1.txt).

## Other embedded notices

Some files under `client/heroui/` include code derived from projects such as Radix Primitives or color utility libraries under MIT-compatible licenses. Their existing SPDX, copyright and attribution headers are part of this distribution and must not be removed.

Remote images referenced by URL, including Unsplash URLs used by the admin interface, are not stored in this repository and remain subject to their providers' terms.
