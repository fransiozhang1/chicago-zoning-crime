# Chicago Zoning & Urban Crime

**Research · DigitalFUTURES 2026 · Human–AI Teaming**

This project studies how reported robbery patterns in Chicago relate to zoning, street conditions and lighting. The workshop used census-tract diagnostics and interpretable models to select tract 4207 for an interactive urban safety simulation. The simulator lets users compare how changes to zoning and the built environment affect the outcomes of its scenario model.

## Repository structure

| Path | Role |
| --- | --- |
| [`apps/simulation-platform`](apps/simulation-platform/) | Main research prototype. React/Vite desktop and mobile interfaces, scenario simulation, maps, reports and the Capacitor Android project. |
| [`packages/zoning-tools`](packages/zoning-tools/) | Rule-based zoning extraction and spatial overlay against census tracts. |
| [`packages/zoning-rag`](packages/zoning-rag/) | Table-aware ordinance retrieval and evidence-linked parameter extraction. |
| [`scripts/prepare_zoning_parameters.py`](scripts/prepare_zoning_parameters.py) | Transfers evidence-linked RAG results to the GIS tool and simulator. |
| [`docs`](docs/) and [`data`](data/) | Research notes, workflow, source revisions and input inventory. |

## Run the platform

Use Node.js 22.12 or newer and npm. From this repository's root:

```sh
npm ci --prefix apps/simulation-platform
npm run dev
```

Open `http://127.0.0.1:3000/` for desktop or `/mobile.html` for the mobile interface. Run `npm run check` for TypeScript checking and `npm run build` to generate both pages in `apps/simulation-platform/dist/`. The demo uses bundled inputs. Online basemaps or optional live layers may require an internet connection.

The deployed versions are [desktop](https://weiyuzhang.space/research/chicago-zoning-crime/simulation/) and [mobile](https://weiyuzhang.space/research/chicago-zoning-crime/simulation/mobile/). The `portfolio` Vite mode builds for that subpath and uses a same-origin CARTO tile endpoint. The site keeps the authorized key in its Worker binding. The default Vite mode retains root paths for the standalone web and Android builds.

## Try the data handoff

Python 3.11 or newer is sufficient for this command, which uses the standard library:

```sh
python scripts/prepare_zoning_parameters.py examples/rag-extraction.sample.csv --join-output .work/tract-parameters.csv --scenario-zone RT-4 --scenario-output .work/rt4-scenario.json
```

The example is synthetic. In the platform, open **Policy Import**, upload `.work/rt4-scenario.json`, and review the proposed values and their source references before applying. The GIS CSV can be passed to `zoningcrime spatial-join --params`.

See the [full workflow](docs/workflow.md) for running the Python components against research inputs, [research notes](docs/research.md) for the study design and reproducibility limits, and [provenance](docs/provenance.md) for upstream revisions and licensing information.
