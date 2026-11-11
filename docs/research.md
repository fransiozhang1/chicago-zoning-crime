# Research notes

## Zoning and urban crime in Chicago

The DigitalFUTURES 2026 workshop presentation situates the project within Human–AI Teaming. Its main question is how zoning, street-view conditions and lighting infrastructure relate to the distribution of reported robberies across Chicago census tracts. The presentation names Xinyao Lyu and Weiyu Zhang as presenters. The title slide lists Pia Fricker, Chaowen Yao, Chenhao Zhu and Yichao Shi under “Team.” The original slide deck supplies the workshop credits.

## Study sequence

1. **Describe the pattern.** Use crime records to identify persistent robbery concentrations, how their shares vary over time and the concentration of reports at night. The presentation describes spatiotemporal clustering and kernel density estimation.
2. **Build environmental inputs.** Combine street imagery and semantic segmentation, lighting outage data and zoning information. The ordinance work compared rule extraction, direct document reading, unstructured retrieval and reconstructed tables. The current RAG pipeline keeps table and page references with its results.
3. **Compare models.** The slides report high in-sample fit for OLS and negative leave-one-out performance. They then present an ensemble and SHAP-based interpretation to explore nonlinear associations. The ensemble performance shown in the deck has not been independently reproduced in this repository.
4. **Prototype scenarios.** The team selected tract 4207 for the urban safety twin. Its interactive models support changes to zoning, building form and environmental settings. The slide deck distinguishes the planning-facing platform from the mobile interface for residents and visitors.

## Reproducibility

The three repositories provide the ordinance extraction and retrieval code, the spatial overlay, and the simulation app with selected tract inputs. They do not contain the original citywide modeling and training pipeline, all historical zoning documents, or all underlying imagery. The app's scenario outputs are conditional on the implemented assumptions. The workshop reports associations and identifies temporal mismatch, limited sample size and incomplete zoning records as sources of uncertainty. Treat SHAP explanations as explanations of model behavior. A causal interpretation would require a separate research design.

Source: DigitalFUTURES_2026_Workshop_G, slides 1–13. Code sources and their revisions are listed in [provenance.md](provenance.md).
