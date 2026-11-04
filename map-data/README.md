# 疆域地图的数据清单

## 不是逐年复原

`territory.html` 是 **来源区间筛选器**。每年可选，但轮廓只在来源记录发生变化时改变，没有插值、形变补间或用相邻年份代替缺失数据。源数据存在政权名称、时段和身份编号错误，不能仅因有多边形就认为该年疆域已核实。

- 时间范围：前221年到1911年，没有零年。
- 地域范围：人工选取中国历史及部分相邻政权，132个原始来源名称、877条原始区间记录。并非完整政权清单，不按现代国界裁切，也没有把现代省界拼成古代疆域。
- 仅使用 POLITY，不把 RELATION 当作独立政权。
- 底图为现代陆地轮廓，不是古代海岸线；无现代国家边界。
- 地图投影：墨卡托，屏幕面积不是可比较的真实面积。
- 原始坐标、原始字段、年份均保留。只做筛选、中文标注、配色、分文件和问题提示，没有简化边界。

## 固定来源与许可

疆域：**Cliopatria / Seshat Global History Databank**, v0.2.1, commit `5f433377139a6eeaeacbdc894b70f8805b72c8b5`。

- [固定仓库版本](https://github.com/Seshat-Global-History-Databank/cliopatria/tree/5f433377139a6eeaeacbdc894b70f8805b72c8b5)
- [原始研究与方法](https://doi.org/10.1038/s41597-025-04516-9)
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；源许可复制于 LICENSE-CLIOPATRIA.md。
- 原始 zip SHA-256：`e10a4e429fca708788ff9e7572a95fce801fae55852d217cffabc1c59cd4eed4`
- 解压 GeoJSON SHA-256：`fc6f0d1e4cc42f45da83522b3696db6f2cc85ec0d12259a85c89b31347b8fc0a`
- 原始文件含13,797条记录。经纬度为 EPSG:4326；日期采用闭区间 `FromYear <= year <= ToYear`。

底图：**Natural Earth 1:110m Land**，公共领域；固定提交 `ca96624a56bd078437bca8184e78163e5039ad19` 中的 `geojson/ne_110m_land.geojson`。仅保留陆地几何，未使用行政界线。[许可说明](https://www.naturalearthdata.com/about/terms-of-use/)。

## 文件

- `polities.json`：本版选取的原始 Name 与中文显示名。不按 Wikidata 编号连接，因原数据存在误配。
- `index.json`：877条记录的来源ID、原名与原始时段。
- `era-N.geojson`：与世纪 N…N+99 相交的完整原始记录。相邻世纪可能包含相同记录，但客户端仅加载当前世纪，每条来源记录只绘制一次。
- `audit.json`：与本站 `data.js` 年表的身份对照、已知错误、缺漏及来源实际时段。年表对照并不验证多边形本身。
- `land.geojson`：Natural Earth 陆地几何。
- `manifest.json`：来源版本、加工说明及本地文件 SHA-256。

## 已知问题与展示策略

1. 名称混用：来源的 Western Jin 记录延伸至425年，Wikipedia 指向晋朝总条目。本版在265–420年明确显示“晋〔来源未分西晋/东晋〕”；421–425年不绘制，并提示缺口。Han Dynasty 同样不默认为西汉或东汉。
2. 时段错位：如秦朝图形只覆盖前218–前209；曹魏从224年、明从1375年、清从1645年开始。使用实际文件，不用常见建国年份修改多边形。
3. v0.2.1 的发行说明称北宋延伸至1127，但实际文件末段是1126–1138。本版依据实际文件审计，在1128–1138年不把该记录画成北宋疆域；南宋来源从1139年开始，缺口明确提示。
4. 五代十国、两晋南北朝与明清之际有大量缺漏和错位。页面对照同期年表，并列出未能单独绘制的政权。来源没有东晋独立名称、武周独立图形等，不意味着那些政权不存在。
5. 不绘制明确超出本站年表纪年的记录，逐年说明被排除的来源名称。仍在年表区间内，不代表轮廓精确或不存在来源错误。
6. 原始研究一般排除面积不足5,000平方公里或存续不足50年的政权（有例外），且没有编码边界的不确定性。本版另有选取范围的遗漏。
7. 不使用明确误配的古代“Great Yuan”或16–17世纪东亚“Golden Horde”，不按错误的 Wikidata 身份进行自动替换。
8. 多边形可能重叠。图层从大到小绘制，颜色不是排他的主权判定。列表可分别选择来源记录。

## 复现与检查

从固定源下载 zip 并解压，运行：

```sh
python3 scripts/build-map-data.py /path/to/cliopatria_polities_only_v021.geojson
node tests/territory.test.cjs
node tests/territory-dom.test.cjs
```

构建脚本先验证原始 GeoJSON SHA-256，仅使用 Python 标准库。测试覆盖区间闭合、公元无零年、并行政权、世纪分片一致性、已知错位排除、坐标范围与环闭合、异步请求竞争、失败重试、播放中断及旧时间轴回归。结构检查不等于历史准确性或拓扑自交检查。
