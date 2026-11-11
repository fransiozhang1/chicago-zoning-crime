# Chicago Zoning Ordinance 参数提取工作流

本文档记录了从原始 PDF 政策文件到结构化参数表的完整数据获取流程。

---

## 工作流总览

```
原始 PDF (275 页)
  │
  ├─► 表格提取 ──► table_to_text.py ──► 表格自然语言文本
  │
  └─► 正文提取 ──► build_clean_policy_text.py ──► 清洗后合并文本
                                                        │
                                                        ▼
                                               build_index.py
                                              构建 RAG 向量索引
                                                        │
                                                        ▼
                                              extract_all_parameters.py
                                         Phase 1: RAG检索 + LLM提取
                                         Phase 2: 同族Zone推断
                                                        │
                                                        ▼
                                               结构化参数表 CSV
```

---

## 第一步：环境准备与依赖安装

**项目路径**：`llamaindex-zoning-rag/`

**核心依赖**：

| 组件 | 用途 |
|---|---|
| `llama-index` | RAG 检索框架，向量索引构建与查询 |
| `huggingface-hub` + `sentence-transformers` | 加载本地 Embedding 模型 `BAAI/bge-small-en-v1.5` |
| `pypdf` | PDF 正文逐页读取 |
| `pdfplumber` | PDF 表格精确提取（**关键组件**） |
| `openai` (SDK) | 调用 DeepSeek API 进行参数提取（OpenAI 兼容协议） |
| `flask` | Web 检索界面 |
| `pyyaml` | 配置文件解析 |

**Embedding 模型**：`BAAI/bge-small-en-v1.5`（HuggingFace 本地加载，无需外部 API）

**LLM**：DeepSeek Chat API（OpenAI 兼容），仅用于参数提取阶段

```powershell
pip install -r requirements.txt
```

**配置文件** `config.yaml`：

```yaml
documents_dir: ./data/raw_documents
storage_dir: ./storage
retrieval:
  top_k: 8
embedding:
  model_name: BAAI/bge-small-en-v1.5
llm:
  provider: deepseek
  model: deepseek-chat
  api_key_env: DEEPSEEK_API_KEY
  base_url: https://api.deepseek.com
```

---

## 第二步：表格提取与自然语言转换（`table_to_text.py`）

> **这是整个工作流的核心预处理步骤。Chicago Zoning Ordinance 包含大量表格（Use Table、Bulk and Density Standards、Parking Standards 等），表格数据往往是参数值的最精确来源。如果跳过此步骤直接将 PDF 当普通文本索引，表格结构信息会完全丢失。**

### 处理流程

1. **读取 PDF**：使用 `pdfplumber` 逐页扫描 `data/raw_documents/chicago-il-1.pdf`
2. **提取表格**：对每一页检测表格结构，提取行列数据
3. **保存原始表格**：所有提取到的表格保存至 `outputs/tables/raw_tables.csv`（含 `table_id`、`source_file`、`page_number`、`table_index`、`raw_table_json`、`table_text`）
4. **表格类型分类**：根据表头关键词自动识别表格类型：

   | 表格类型 | 识别关键词 | 示例 |
   |---|---|---|
   | `use_table` | Permitted / Special Use / Use Group | 17-2-0207 Use Table |
   | `bulk_density_table` | Floor Area Ratio / Lot Area / Height / Setback | 17-3-0500 Bulk Standards |
   | `parking_table` | Parking / Spaces / Accessory / Non-Accessory | 17-10-0207 Parking Table |
   | `landscaping_screening_table` | Landscaping / Screening / Buffer / Fence | 17-10-0600 Landscaping |
   | `zoning_conversion_table` | Previous / Converted / District Conversion | 1957 Conversion Table |
   | `unknown_table` | 无法匹配以上类别 | 待人工审核 |

5. **逐行转换为自然语言文本**：
   - Use Table 行 → `"In [context], [use type] is [status] in [zoning district]."`
   - Bulk Table 行 → `"In [district], [parameter] is [value] [unit]."`
   - Parking Table 行 → `"For [use type], the parking requirement is [value]."`
6. **保存文本块**：输出至 `outputs/tables/table_text_chunks.csv`

### 提取结果统计

| 指标 | 数量 |
|---|---|
| PDF 总页数 | 275 |
| 提取到的原始表格 | **130 个** |
| 表格文本块总行数 | **1,753 行** |
| use_table 行数 | 362 |
| bulk_density_table 行数 | 219 |
| parking_table 行数 | 176 |
| zoning_conversion_table 行数 | 59 |
| landscaping_screening_table 行数 | 24 |
| unknown_table 行数 | 913 |

### 运行命令

```powershell
python src/table_to_text.py `
  --input data/raw_documents/chicago-il-1.pdf `
  --output-dir outputs/tables
```

---

## 第三步：生成清洁策略文本（`build_clean_policy_text.py`）

将原始 PDF 的正文文本与第二步生成的表格自然语言描述合并，构成一份"干净的"政策文本，作为后续 RAG 索引的唯一数据源。

### 处理逻辑

1. **逐页读取正文**：使用 `pypdf` 提取每页正文文本
2. **正文清洗**（`clean_pdf_text` 函数）：
   - 移除 PDF 内部对象引用（如 `(17-3-xxx)` 格式的内部链接标记）
   - 修复被错误断行的句子（合并单个换行符，保留段落分隔）
   - 清除乱码字符和非 ASCII 噪音
   - 去除页眉页脚重复内容
3. **加载表格文本**：从 `outputs/tables/table_text_chunks.csv` 读取并按页码分组
4. **逐页合并**：对每一页，先输出正文文本，再附加该页对应的表格文本描述块
5. **双重输出**：
   - **Markdown 文件**：`outputs/clean_text/chicago_zoning_cleaned.md`（人类可读）
   - **结构化 CSV 索引**：`outputs/clean_text/clean_text_index.csv`（供 LlamaIndex 读取）

### CSV 索引结构

| 字段 | 说明 | 示例 |
|---|---|---|
| `section_id` | 唯一标识 | `page_42_text` / `page_42_table_005` |
| `source_file` | 源文件 | `chicago-il-1.pdf` |
| `page_number` | 页码 | `42` |
| `content_type` | 内容类型 | `page_text` / `table_text` / `page_boundary` |
| `table_id` | 表格 ID（仅 table_text） | `page_42_t5` |
| `table_type` | 表格类型（仅 table_text） | `bulk_density_table` |
| `text` | 文本内容 | 正文或自然语言表格描述 |

每条文本索引时附带元数据头，例如：

```
[PAGE_TEXT]
Source file: chicago-il-1.pdf
Page: 42

... cleaned body text ...
```

```
[TABLE_TEXT]
Source file: chicago-il-1.pdf
Page: 42
Table ID: page_42_t3
Table Type: parking_table

- For detached house in RT-4, the parking requirement is 1 space per dwelling unit.
- For detached house in RS-3, the parking requirement is 2 spaces per dwelling unit.
```

### 输出统计

| 文件 | 内容 |
|---|---|
| `chicago_zoning_cleaned.md` | 275 页完整清洁文本 |
| `clean_text_index.csv` | 27,411 行（275 page_text + 275 page_boundary + 127 table_text blocks） |

### 运行命令

```powershell
python src/build_clean_policy_text.py `
  --pdf data/raw_documents/chicago-il-1.pdf `
  --tables outputs/tables/table_text_chunks.csv `
  --output-md outputs/clean_text/chicago_zoning_cleaned.md `
  --output-csv outputs/clean_text/clean_text_index.csv
```

---

## 第四步：构建 RAG 向量索引（`build_index.py`）

将清洁文本索引转换为 LlamaIndex `VectorStoreIndex`，供后续语义检索使用。

### 构建逻辑

1. **优先读取** `outputs/clean_text/clean_text_index.csv`
2. 如果该文件不存在，则回退到直接读取 `data/raw_documents/` 中的原始 PDF（可通过 `--raw` 参数强制走回退路径）
3. 每一行 CSV 转换为一个 LlamaIndex `Document`：
   - `text` 字段作为文档内容（已包含元数据头）
   - 所有元数据（`source_file`、`page_number`、`content_type`、`table_id`、`table_type`）附加到 Document metadata
4. 使用 `BAAI/bge-small-en-v1.5` 将文档向量化
5. 持久化到 `storage/` 目录

### 索引统计

| 指标 | 数值 |
|---|---|
| 索引文档数 | ~7,000+ chunks（27,411 行 CSV 经合并后） |
| 向量维度 | 384（bge-small-en-v1.5 输出维度） |
| 存储大小 | 7.6 MB |
| Embedding 模型大小 | ~199 参数文件（轻量级） |

### 运行命令

```powershell
# 首次构建（推荐：先删除旧索引）
Remove-Item -Recurse -Force .\storage\
python src/build_index.py --config config.yaml

# 强制走原始 PDF 路径
python src/build_index.py --config config.yaml --raw
```

---

## 第五步：检索测试与 Web 界面

### 命令行检索（`query_index.py`）

```powershell
python src/query_index.py --query "RT4 floor area ratio maximum FAR table" --config config.yaml
```

结果保存至 `outputs/retrieval/single_query_results.csv`，含以下字段：

| 字段 | 说明 |
|---|---|
| `query` | 查询文本 |
| `rank` | 结果排序 |
| `score` | 语义相似度得分 |
| `content_type` | `page_text` / `table_text` |
| `source_file` | 来源文件 |
| `page_number` | 页码 |
| `table_id` | 表格 ID（仅 table_text） |
| `table_type` | 表格类型（仅 table_text） |
| `text` | 检索到的文本片段 |

### Web 检索界面（`server.py`）

```powershell
python src/server.py --config config.yaml
```

浏览器访问 `http://localhost:5000`，提供可视化搜索界面。

---

## 第六步：参数提取（`extract_all_parameters.py`）

### 输入数据

**Zone 来源**：从芝加哥政府公开数据 `Boundaries_Zoning_filtered.csv` 中提取所有唯一 zone class，共 **51 个**：

| Zone 族 | 数量 | 示例 |
|---|---|---|
| R (住宅区) | 8 | RS-1, RS-2, RS-3, RT-3.5, RT-4, RM-4.5, RM-5, RM-6 |
| B (社区商业) | 9 | B1-1, B1-2, B1-3, B1-5, B2-2, B2-3, B3-1, B3-2, B3-3, B3-5 |
| C (商业区) | 5 | C1-1, C1-2, C1-3, C2-1, C2-2 |
| M (工业区) | 5 | M1-1, M1-2, M2-1, M3-2, M3-3 |
| PD (规划开发区) | 21 | PD 42, PD 74, PD 1091, ... |
| POS (公共开放空间) | 2 | POS-1, POS-2 |
| T (交通) | 1 | T |

**参数定义**：从 `zoning_parameters_for_extraction.csv` 读取，共 **23 个参数**，按类别分：

| 类别 | 参数 | 优先级 |
|---|---|---|
| basic_zoning | `zone_family` | 1 |
| use_regulation | `allowed_use_status`、`special_use_required`、`planned_development_required`、`residential_use_allowed`、`commercial_use_allowed`、`manufacturing_use_allowed`、`non_accessory_parking_allowed` | 1~2 |
| parking | `parking_requirement`、`parking_standard` | 1~2 |
| bulk_density | `min_lot_area`、`lot_area_per_unit`、`max_far`、`front_setback`、`max_height` | 1 |
| design_overlay | `pedestrian_street_overlay`、`transparency_requirement`、`entrance_requirement` | 2 |
| parking_design | `parking_location_restriction`、`driveway_access_restriction` | 2~3 |
| landscape_screening | `landscaping_required`、`screening_required`、`buffer_required` | 3 |

每个参数在 CSV 中均定义了 `extraction_query_template`（如 `"{zone_class} floor area ratio maximum FAR bulk table"`），用于生成针对性的 RAG 检索查询。

### 两阶段提取流程

**Phase 1：RAG 检索 + LLM 提取**

```
对每个 (zone_class, parameter) 组合:
  1. 根据 extraction_query_template 生成检索查询
  2. 从 VectorStoreIndex 检索 top_k (默认 10) 个最相关文本片段
  3. 将检索结果格式化后送入 DeepSeek LLM
  4. LLM 输出严格 JSON，包含: value, unit, status, evidence, confidence, notes
  5. 解析 JSON，保存结果
```

**Phase 2：同族 Zone 推断**

```
对 Phase 1 中 status=not_found 的行:
  1. 收集同一 zone_family（如 R-family）中 status=found 的已知值
  2. 将已知值列表送入 LLM 进行模式推理
  3. LLM 输出推断值、置信度和推理依据
  4. 标记 extraction_method 为 "inferred"
```

### 关键设计决策

- **表格优先**：Prompt 明确指示 LLM 优先采用 `[TABLE_TEXT RESULT]` 而非 `[PAGE_TEXT RESULT]`，因为表格是参数值的最精确来源
- **严格 JSON**：Prompt 要求 LLM 输出纯 JSON（无 Markdown、无代码围栏、无额外解释），配合多策略 JSON 解析器（5 种降级策略）
- **状态标记**：`found` / `ambiguous` / `not_found` / `not_applicable`，配合 `confidence`（high/medium/low）量化置信度
- **证据保存**：每个 (zone, parameter) 的 10 条检索结果完整保存至 evidence CSV，支持人工回溯验证

### 提取结果统计

| 提取方式 | 数量 | 占比 | 说明 |
|---|---|---|---|
| rag_found | 254 | 21.7% | 直接从 RAG 检索原文中提取到明确数值 |
| inferred | 118 | 10.1% | Phase 2 从同族 zone 的值模式中推断 |
| ambiguous | 22 | 1.9% | 原文中存在多个条件值，需人工判断 |

| 指标 | 数值 |
|---|---|
| 总处理组合数 | **1,173** (51 zones × 23 params) |
| 总 API 调用次数 | 1,173（Phase 1）+ 约 900（Phase 2） |
| 检索证据总量 | 11,730 条（每组合 10 条 × 1,173） |
| 零 JSON 解析错误 | 是 |

### R 族（住宅区）Bulk Density 提取效果（最佳）

| Zone | max_far | min_lot_area | lot_area_per_unit | max_height |
|---|---|---|---|---|
| RS-1 | 0.50 | 6,250 sqft | 6,250 sqft | 30 ft |
| RS-2 | 0.65 | 5,000 sqft | 5,000 sqft | 30 ft |
| RS-3 | 0.90 | 2,500 sqft | 2,500 sqft | 30 ft |
| RT-3.5 | 1.05 | 2,500 sqft | 1,250 sqft | 35 ft |
| RT-4 | 1.20 | 1,000 sqft | 1,000 sqft (DW) | 38 ft |
| RM-4.5 | 1.70 | 1,650 sqft | 700 sqft (DW) | — |
| RM-5 | 2.00 | 400 sqft | 400 sqft (DW) | — |
| RM-6 | 4.40 | 1,650 sqft | 300 sqft (DW) | — |

### 运行命令

```powershell
# 完整提取
$env:DEEPSEEK_API_KEY = "your-api-key"
python -u src/extract_all_parameters.py `
  --config config.yaml `
  --output outputs/results/all_zone_parameter_results.csv `
  --evidence-output outputs/results/all_zone_parameter_retrieval_evidence.csv `
  --param-csv zoning_parameters_for_extraction.csv `
  --zone-txt zone_classes.txt `
  --top-k 10

# 跳过 Phase 2（仅 RAG 提取）
python src/extract_all_parameters.py `
  --config config.yaml `
  --skip-inference
```

---

## 输出文件清单

| 文件路径 | 说明 | 行/条目数 |
|---|---|---|
| `outputs/tables/raw_tables.csv` | 原始表格（含 JSON） | 130 |
| `outputs/tables/table_text_chunks.csv` | 表格自然语言文本块 | 1,753 |
| `outputs/clean_text/chicago_zoning_cleaned.md` | 清洁合并文本 | 275 页 |
| `outputs/clean_text/clean_text_index.csv` | 结构化文本索引 | 27,411 |
| `storage/` | 向量索引持久化目录 | 7.6 MB |
| `outputs/results/all_zone_parameter_results.csv` | 参数提取结果表 | 1,173 |
| `outputs/results/all_zone_parameter_retrieval_evidence.csv` | 检索证据完整记录 | 11,730 |

---

## 脚本总览

| 脚本 | 功能 | 依赖上一步 |
|---|---|---|
| `src/table_to_text.py` | PDF → 表格提取 + 自然语言转换 | 无 |
| `src/build_clean_policy_text.py` | 正文 + 表格文本合并 | table_text_chunks.csv |
| `src/build_index.py` | 构建 RAG 向量索引 | clean_text_index.csv |
| `src/query_index.py` | 命令行检索测试 | storage/ |
| `src/server.py` | Web 检索界面 | storage/ |
| `src/extract_all_parameters.py` | 批量参数提取 | storage/ + zone_classes.txt + params CSV |
