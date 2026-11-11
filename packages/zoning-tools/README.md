# 芝加哥区划参数工具

两个 Python 工具，用于芝加哥区划法规研究：

1. **参数提取器** — 从 PDF / DOCX / TXT / CSV 中提取区划参数
2. **区划空间叠加** — 将区划多边形叠加到人口普查区

---

## 项目结构

```
├── data/
│   ├── raw_documents/     # 待提取的原始文档
│   ├── zoning_maps/       # 区划多边形图层 (geojson / shp / gpkg)
│   └── census_tracts/     # 人口普查区多边形图层
├── outputs/
│   ├── parameters/        # 提取出的参数 CSV
│   └── spatial/           # 按普查区汇总的区划指标 CSV
├── zoningcrime/
│   ├── extractor.py
│   ├── spatial_join.py
│   └── cli.py
├── .cursor/
│   └── skills/            # Cursor 技能文件（安装后可在任何项目中使用）
├── requirements.txt
└── README.md
```

---

## 安装

本项目由两部分组成：**Python 依赖** 和 **Cursor 技能文件**。

### 第一步：安装 Python 依赖

> 需要 Python 3.10 或更高版本

在项目根目录打开终端，执行：

```bash
pip install -r requirements.txt
```

这会安装以下核心库：`pandas`、`numpy`、`geopandas`、`shapely`、`pypdf`、`python-docx`。

---

### 第二步：安装 Cursor 技能（强烈推荐）

#### 什么是技能（Skill）？

技能是 Cursor 的「我知道怎么跑这个任务」配置文件。每个技能就是一个 `SKILL.md` 文件。安装了技能后，你在 Cursor 聊天框里直接发一句「帮我提取这个 PDF 的参数」，Cursor 就能自动找到正确的工具来运行，不需要你手动解释怎么操作。

本项目提供了两个技能：

| 技能名称 | 做什么 |
|---|---|
| `zoning-crime-extract` | 从 PDF / DOCX / TXT / CSV 中提取区划参数 |
| `zoning-crime-spatial-join` | 将区划图叠加到人口普查区，计算各区域的区划指标 |

---

#### 安装方式

技能文件位于项目中的 `.cursor/skills/` 文件夹。你可以选择下面两种安装方式之一。

---

##### 方式一：复制到用户目录（推荐，安装一次，所有项目都能用）

将项目中的技能文件夹复制到你电脑上 Cursor 的用户技能目录。

**Windows 系统：**

打开 PowerShell，进入项目根目录，执行：

```powershell
# 如果用户技能目录还不存在，先创建
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cursor\skills"

# 将本项目中的两个技能复制过去
Copy-Item -Recurse -Force ".\\.cursor\\skills\\zoning-crime-extract" "$env:USERPROFILE\\.cursor\\skills\\"
Copy-Item -Recurse -Force ".\\.cursor\\skills\\zoning-crime-spatial-join" "$env:USERPROFILE\\.cursor\\skills\\"
```

**macOS / Linux 系统：**

打开终端，进入项目根目录，执行：

```bash
# 如果用户技能目录还不存在，先创建
mkdir -p ~/.cursor/skills

# 将本项目中的两个技能复制过去
cp -r ./.cursor/skills/zoning-crime-extract ~/.cursor/skills/
cp -r ./.cursor/skills/zoning-crime-spatial-join ~/.cursor/skills/
```

安装完成后，无论你打开的是本项目还是其他项目，这两个技能都能使用。

---

##### 方式二：直接用（仅当前项目可用）

技能文件已经在项目的 `.cursor/skills/` 目录中了。只要你在 Cursor 里打开的是这个项目，它们就会自动生效，不需要任何额外操作。

> 注意：如果你之前已经按方式一安装到了用户目录，后来又在本项目里修改了技能文件，Cursor 会以项目内的版本为准。

---

#### 如何确认安装成功？

1. 打开 Cursor，按下 `Ctrl + Shift + P`（macOS 按 `Cmd + Shift + P`）
2. 在弹出的命令面板中搜索 `Cursor: List Skills`
3. 在列表中应该能看到 `zoning-crime-extract` 和 `zoning-crime-spatial-join`

---

#### 安装后怎么用？

把技能当成「快捷命令」即可。在 Cursor 聊天框中：

- 输入 `/zoning-crime-extract`，然后把你要提取的文件拖到聊天框里
- 输入 `/zoning-crime-spatial-join`，然后告诉 AI 你的区划图和普查区图在哪

也可以不用斜杠命令，直接说你要做的事，比如：

> 「帮我提取这个 PDF 里关于住宅建筑退线的参数」

Cursor 会根据你的描述自动匹配并激活对应的技能。

---

### 不使用 Cursor 怎么用？

如果你使用的不是 Cursor（或者不想装技能），也可以直接在终端里运行 Python 命令。使用方法参见下面两个工具的说明。

---

## 工具一：参数提取器

读取一个**文件**或**文件夹**，用关键词规则（非 LLM）从文本中提取区划参数。

### 支持的输入格式

- PDF（通过 `pypdf`）
- DOCX（通过 `python-docx`）
- TXT 纯文本
- CSV（预先整理好的参数表，或者带 `original_text` / `text` 列的原始文本）

### 提取规则

- `parameter_value` 字段**永远是数字、范围或 yes/no**，不会是整句文字
- 单位标准化：`ft`、`stories`、`sq ft`、`%`、`FAR`、`spaces/unit`、`spaces/1000 sq ft`、`boolean`
- 支持英文数字词（如 `sixty-five` → `65`）
- 一句话包含多个参数时，会自动拆分为独立行

### 输出字段

| 字段 | 说明 |
|------|------|
| source_file | 源文件名 |
| source_page | 页码，或 `txt` / `docx` |
| zoning_district | 区划代码（如 RS-3、B3），未识别则为 `unknown` |
| parameter_name | 参数名（如 `max_height`、`FAR`、`setback_front`） |
| parameter_value | 数字、范围（`35-50`）或 `yes` / `no` |
| unit | 标准化单位，或 `boolean` |
| original_text | 原始句子，方便人工核查 |
| confidence | 可信度：`high` / `medium` / `low` |

### 命令行用法

**批量处理文件夹：**

```bash
python -m zoningcrime extract \
  --input ./data/raw_documents \
  --output ./outputs/parameters/zoning_parameters_extracted.csv
```

**处理单个文件：**

```bash
python -m zoningcrime extract \
  --input ./data/raw_documents/zoning_1927.pdf \
  --output ./outputs/parameters/zoning_parameters_extracted.csv
```

**按文件类型过滤：**

```bash
python -m zoningcrime extract \
  --input ./data/raw_documents \
  --output ./outputs/parameters/zoning_parameters_extracted.csv \
  --type pdf
```

### 定向提取模式（推荐）

如果你先从 GIS 统计出了研究区内出现的 ZONE_CLASS，可以只查询这些区划类型的参数，避免无目标的全文扫描。

**第一步：准备 ZONE_CLASS 统计文件**

创建一个文本文件 `./data/ZONE_CLASS_stats.txt`，每行列出一个需要查询的区划类型：

```
RT-4
B3-1
RS-3
C1-2
B1-1
B3-2
C1-1
M1-2
M1-1
POS-2
RM-5
C2-2
PD 323
T
```

**第二步：运行定向提取**

```bash
python -m zoningcrime extract \
  --input ./data/raw_documents/chicago-il-1.pdf \
  --zone-classes ./data/ZONE_CLASS_stats.txt \
  --output ./outputs/parameters/zone_class_parameters.csv
```

**定向提取的参数类别**

定向模式会自动提取以下五类参数：

1. **夜间用途 / 酒精 / 娱乐：** `tavern_allowed`、`bar_allowed`、`liquor_sales_allowed`、`nightclub_allowed`、`adult_use_allowed`、`special_use_required_for_nightlife`
2. **照明与可见性：** `lighting_required`、`parking_lot_lighting_required`、`security_lighting_required`、`minimum_lighting_level`
3. **街道界面 / 自然监视：** `active_frontage_required`、`ground_floor_commercial_allowed`、`transparent_frontage_required`、`blank_wall_limit`、`window_requirement`、`entrance_spacing`、`front_setback`、`build_to_line`
4. **停车场与空地管理：** `surface_parking_allowed`、`parking_lot_screening_required`、`parking_requirement`、`fence_required`、`landscaping_required`、`screening_required`
5. **距离限制 / 缓冲：** `distance_from_residential`、`distance_from_school`、`distance_from_church`、`distance_from_park`、`distance_between_liquor_uses`、`buffer_required`、`buffer_width`

**定向提取输出字段**

| 字段 | 说明 |
|------|------|
| source_file | 源文件名 |
| source_page | 页码 |
| zone_class | 区划类型（如 RT-4、B3-1、PD 323） |
| zone_family | 大类：residential / business_commercial / manufacturing / downtown / open_space / transportation / planned_development |
| parameter_name | 参数名 |
| parameter_value | 数字、范围，或 yes / no |
| unit | 标准化单位 |
| value_type | numeric / boolean / special_use / planned_development / text / missing |
| original_text | 原始句子 |
| confidence | high / medium / low |
| matched_section | 来源章节（如 17-2 Residential Districts） |

**针对不同 zone_family 的策略**

- RS / RT / RM → 优先查 17-2 Residential Districts
- B / C → 优先查 17-3 Business and Commercial Districts
- M → 优先查 17-5 Manufacturing Districts
- PD → 生成 `requires_pd_ordinance_lookup = yes`（PD 的参数通常在单独的 PD ordinance 文件中）
- POS → 查 17-6 Special Purpose Districts
- T → 查特殊用途区章节；如无明确参数，标注低可信度

**运行统计示例**

```
  输入 zone class 数量:           21
  成功提取到参数的 zone class:    18
  未找到参数的 zone class:        3
  输出参数总行数:                 142
  numeric 参数数量:               68
  boolean 参数数量:               52
  special use 参数数量:           8
  low confidence 行数:            14
```

---

## 工具二：区划空间叠加

将区划多边形叠加到人口普查区多边形上，按普查区汇总面积比例和加权参数平均值。

### 工作原理

- 区划的分类（居住 / 商业 / 工业 / 混合用途 / 未知）**直接内置在 spatial_join 中**，不需要单独的标准化步骤
- 通过 geopandas 的 `overlay（intersection）` 方法进行空间叠加
- 图层统一投影到 EPSG:3435 坐标系计算面积

### 输入

- 区划多边形文件（geojson、shp、gpkg，或带 `the_geom` WKT 列的 CSV）
- 人口普查区多边形文件
- 参数提取器输出的 CSV

### 输出字段

| 字段 | 说明 |
|------|------|
| year | 分析年份 |
| census_tract | 普查区编号 |
| tract_area | 普查区总面积（平方米，EPSG:3435） |
| residential_area | 住宅用地区划面积 |
| commercial_area | 商业用地区划面积 |
| industrial_area | 工业用地区划面积 |
| mixed_use_area | 混合用地区划面积 |
| unknown_area | 未识别区域面积 |
| residential_ratio | 住宅用地面积占比 |
| commercial_ratio | 商业用地面积占比 |
| industrial_ratio | 工业用地面积占比 |
| mixed_use_ratio | 混合用地面积占比 |
| unknown_ratio | 未识别面积占比 |
| dominant_zone_type | 主导区划类型（面积最大的类别） |
| avg_max_height | 面积加权平均最大高度 |
| avg_far | 面积加权平均容积率 |
| avg_parking_requirement | 面积加权平均停车要求 |

### 命令行用法

```bash
python -m zoningcrime spatial-join \
  --zoning ./data/zoning_maps/zoning_2026.geojson \
  --tracts ./data/census_tracts/tracts.geojson \
  --params ./outputs/parameters/zoning_parameters_extracted.csv \
  --year 2026 \
  --output ./outputs/spatial/zoning_indicators_by_tract_2026.csv
```

### 注意事项

- 两个图层都必须有有效的坐标系（CRS），且空间范围有交集
- 未与区划图叠加到的普查区面积计入 `unknown`

---

## 常见问题

**Q：我没有 Cursor，能直接跑 Python 吗？**

可以。用 `pip install -r requirements.txt` 安装依赖后，直接运行上面列出的 `python -m zoningcrime extract ...` 或 `python -m zoningcrime spatial-join ...` 命令即可。

**Q：提取结果里 parameter_value 为空的行是干什么的？**

这些行的原始文本中含有相关关键词，但未能从中提取到明确的数字。它们标注了可能存在参数的句子位置，方便人工判断是否需要补充。

**Q：支持多页 PDF 吗？**

支持。提取器会逐页读取 PDF，并在 `source_page` 字段标注页码。

**Q：CRS 是什么？我的数据没有坐标系怎么办？**

CRS（Coordinate Reference System）是地图数据的位置参考信息。如果 geopandas 读到没有 CRS 的文件，空间叠加会报错。你需要先确认数据来源的坐标系（芝加哥地区常用 `EPSG:4326`），然后用 `gdf.crs = "EPSG:4326"` 赋值。
