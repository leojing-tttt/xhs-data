# language: zh-CN
功能: 导出小红书搜索结果笔记

  在小红书 PC 的推荐页或搜索结果页，按填写的条数导出当前这一种列表。
  已经捕获的不够时，用页面自己的下一页继续要：只沿用页面已经发出的接口，游标和 search id 从页面自己的响应里拿。
  不另造签名，不绕过登录，也不伪造 Cookie。凑不够就导出已经拿到的，并写清目标条数和实际条数。

  场景: 从搜索接口响应解析笔记列表
    假如已有搜索接口响应夹具"notes-basic.json"
    当解析该搜索响应
    那么捕获到2条笔记
    而且第1条笔记的笔记ID为"66dee9a10000000012011511"
    而且第1条笔记的标题为"大平层装修避坑"
    而且第1条笔记的作者为"装修日记"
    而且第1条笔记的作者ID为"user_1"
    而且第1条笔记的作者主页为"https://www.xiaohongshu.com/user/profile/user_1"
    而且第1条笔记的点赞数为"128"
    而且第1条笔记的笔记类型为"图文"
    而且第1条笔记的封面图为"https://cdn.example.com/cover-a.jpg"
    而且第1条笔记的笔记链接为"https://www.xiaohongshu.com/explore/66dee9a10000000012011511"
    而且第2条笔记的笔记类型为"视频"
    而且第2条笔记的点赞数为"1.2万"

  场景: 响应里带有页面令牌时笔记链接沿用搜索页打开方式
    假如已有搜索接口响应夹具"notes-with-token.json"
    当解析该搜索响应
    那么第1条笔记的笔记链接为"https://www.xiaohongshu.com/explore/tokennote00000000000001?xsec_token=pc-token&xsec_source=pc_search"

  场景: 笔记写在 note 字段时同样解析
    假如已有搜索接口响应夹具"notes-legacy-note.json"
    当解析该搜索响应
    那么捕获到1条笔记
    而且第1条笔记的笔记ID为"legacyid00000000000001"
    而且第1条笔记的标题为"旧字段标题"
    而且第1条笔记的作者为"旧作者"
    而且第1条笔记的作者ID为"legacy-user"
    而且第1条笔记的笔记类型为"视频"
    而且第1条笔记的封面图为"https://cdn.example.com/legacy.jpg"

  场景: 继续加载时按笔记ID去重并累加
    假如已有搜索接口响应夹具"notes-basic.json"
    当解析该搜索响应
    当再解析搜索接口响应夹具"notes-scroll.json"
    那么捕获到3条笔记
    而且笔记ID依次为"66dee9a10000000012011511,6480be44000000001300b41e,aabbccddeeff001122334455"

  场景: 跳过推荐词等非笔记条目
    假如已有搜索接口响应夹具"notes-with-non-notes.json"
    当解析该搜索响应
    那么捕获到1条笔记
    而且第1条笔记的笔记ID为"onlynote000000000000001"

  场景: 导出表使用中文列头且一行一条笔记
    假如已有搜索接口响应夹具"notes-basic.json"
    当解析该搜索响应
    当映射为Excel行并生成工作簿
    那么表头依次为"笔记ID,标题,作者,作者ID,作者主页,点赞数,笔记类型,封面图,笔记链接"
    而且数据行数为2
    而且第1条数据的标题为"大平层装修避坑"
    而且工作簿工作表名为"搜索结果"
    而且工作簿第1行表头与导出表头一致
    而且工作簿第2行笔记ID为"66dee9a10000000012011511"

  场景: 载荷中从未出现的列会被省略
    假如已有搜索接口响应夹具"notes-minimal.json"
    当解析该搜索响应
    当映射为Excel行并生成工作簿
    那么表头依次为"笔记ID,标题,作者,作者主页,笔记链接"
    而且第1条数据的作者主页为""
    而且表头包含"标题"
    而且表头包含"作者"
    而且表头包含"笔记链接"

  场景: 按页面关键词和本地时间命名文件
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE&source=web_user_page"
    而且本地时间为"2026-11-04 03:56"
    而且已有搜索接口响应夹具"notes-basic.json"
    当解析该搜索响应
    当用户请求导出
    那么会生成文件
    而且文件名为"小红书搜索_大平层装修_20261104-0356.xlsx"

  场景: 关键词含有文件名不能使用的字符时仍能命名
    假如搜索关键词为"大平层/装修"
    而且本地时间为"2026-11-04 03:56"
    当生成导出文件名
    那么文件名为"小红书搜索_大平层_装修_20261104-0356.xlsx"

  场景: 还没有笔记时导出说明原因且不下载
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE"
    而且当前没有捕获到笔记
    当渲染页内面板
    那么面板文案包含"已捕获 0 条笔记"
    而且提示包含"还没有捕获到笔记"
    当用户请求导出
    那么不生成文件
    而且提示包含"还没有捕获到笔记"

  场景大纲: 这些地址不能导出
    假如当前页面地址为"<地址>"
    当判断扩展是否可用
    那么不可导出
    而且提示包含"不是小红书推荐页或搜索结果页"

    例子:
      | 地址 |
      | https://www.xiaohongshu.com/explore/66dee9a10000000012011511 |
      | https://www.xiaohongshu.com/user/profile/user_1 |
      | https://example.com/search_result?keyword=a |
      | https://www.xiaohongshu.com/search_result_fake?keyword=a |

  场景: 搜索结果页可以导出并读出关键词
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE&source=web_user_page"
    当判断扩展是否可用
    那么可以导出
    而且关键词为"大平层装修"

  场景: 接口结构无法识别时从可见卡片回退
    假如已有搜索接口响应夹具"unrecognized.json"
    而且已有可见卡片夹具"cards.html"
    当解析该搜索响应并在无法识别时回退可见卡片
    那么捕获到1条笔记
    而且第1条笔记的标题为"可见卡片标题"
    而且第1条笔记的作者为"作者甲"
    而且第1条笔记的笔记链接为"https://www.xiaohongshu.com/explore/visible1"

  场景: 接口结构能识别但没有笔记时不用可见卡片凑数
    假如已有搜索接口响应夹具"notes-empty.json"
    而且已有可见卡片夹具"cards.html"
    当解析该搜索响应并在无法识别时回退可见卡片
    那么捕获到0条笔记

  场景: 已经从接口捕获后不用可见卡片覆盖
    假如已有搜索接口响应夹具"notes-basic.json"
    而且已有可见卡片夹具"cards.html"
    当解析该搜索响应
    当按可见卡片刷新捕获
    那么捕获到2条笔记
    而且第1条笔记的笔记ID为"66dee9a10000000012011511"

  场景: 关键词变化后清空已捕获笔记
    假如当前搜索关键词为"大平层装修"
    而且已有搜索接口响应夹具"notes-basic.json"
    当解析该搜索响应
    当搜索关键词变为"另一关键词"
    那么捕获到0条笔记

  场景: 地址暂时不带关键词时保留已捕获笔记
    假如当前搜索关键词为"大平层装修"
    而且已有搜索接口响应夹具"notes-basic.json"
    当解析该搜索响应
    当搜索关键词变为""
    那么捕获到2条笔记

  场景: 页内面板显示已捕获数量和导出按钮
    假如已有搜索接口响应夹具"notes-basic.json"
    当解析该搜索响应
    当渲染页内面板
    那么面板文案包含"已捕获 2 条笔记"
    而且面板包含按钮"导出 Excel"

  场景: 站点重定向后的搜索地址也可以导出
    假如当前页面地址为"http://www.xiaohongshu.com/search_result/?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE&source=web_user_page"
    当判断扩展是否可用
    那么可以导出
    而且关键词为"大平层装修"

  场景大纲: 这些真实页面地址都会注入内容脚本
    当检查扩展清单是否注入"<地址>"
    那么会注入内容脚本

    例子:
      | 地址 |
      | https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE&source=web_user_page |
      | https://www.xiaohongshu.com/search_result/?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE |
      | http://www.xiaohongshu.com/search_result/?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE&source=web_user_page |
      | https://www.xiaohongshu.com/ |
      | https://xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82%E8%A3%85%E4%BF%AE |

  场景: 页面给出的作者主页地址优先于作者 ID
    假如已有搜索接口响应夹具"notes-profile-url.json"
    当解析该搜索响应
    那么第1条笔记的作者主页为"https://www.xiaohongshu.com/user/profile/realUser?xsec_token=user-token&xsec_source=pc_feed"

  场景: 推荐首页可以导出
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    当判断扩展是否可用
    那么可以导出
    而且当前列表为"推荐"

  场景大纲: 这些地址都是推荐页
    假如当前页面地址为"<地址>"
    当判断扩展是否可用
    那么可以导出
    而且当前列表为"推荐"

    例子:
      | 地址 |
      | https://www.xiaohongshu.com/ |
      | https://www.xiaohongshu.com/explore/ |
      | http://xiaohongshu.com/explore |
      | https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend |

  场景: 推荐页和搜索页各自累积，导出互不混入
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"推荐"记入当前列表
    而且已有搜索接口响应夹具"notes-minimal.json"
    当把该响应作为"搜索"记入当前列表
    那么捕获到2条笔记
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    当把该响应作为"搜索"记入当前列表
    那么捕获到1条笔记
    而且第1条笔记的标题为"只有标题和作者"
    而且第1条笔记的作者主页为""
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    当查看当前列表
    那么捕获到2条笔记
    而且第1条笔记的作者主页为"https://www.xiaohongshu.com/user/profile/user_1"

  场景: 推荐页按本地时间命名且不含搜索关键词
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    而且本地时间为"2026-11-04 03:56"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"推荐"记入当前列表
    当用户请求导出
    那么会生成文件
    而且文件名为"小红书推荐_20261104-0356.xlsx"
    当映射为Excel行并生成工作簿
    那么工作簿工作表名为"推荐"
    而且表头包含"作者主页"

  场景: 切页后不会把还留在页面上的上一份卡片记进新列表
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"推荐"记入当前列表
    而且已有可见卡片夹具"cards-held.html"
    当把这些卡片记成刚离开的列表
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    当用仍在页面上的卡片刷新当前列表
    那么捕获到0条笔记

  场景: 推荐页面板标明当前导出的是推荐
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"推荐"记入当前列表
    当渲染页内面板
    那么面板文案包含"推荐"
    而且面板文案包含"已捕获 2 条笔记"
    而且面板包含按钮"导出 Excel"

  场景: 页内面板挂在文档根上并固定在视口
    当挂载页内面板到文档
    那么面板挂在文档根节点上
    而且面板使用固定定位

  场景: 搜索接口用驼峰字段时同样解析
    假如已有搜索接口响应夹具"notes-camel.json"
    当解析该搜索响应
    那么捕获到1条笔记
    而且第1条笔记的笔记ID为"camelfeed00000000000001"
    而且第1条笔记的标题为"驼峰标题"
    而且第1条笔记的作者为"驼峰作者"
    而且第1条笔记的作者ID为"camel-user"
    而且第1条笔记的点赞数为"88"
    而且第1条笔记的笔记类型为"视频"
    而且第1条笔记的封面图为"https://cdn.example.com/camel.jpg"
    而且第1条笔记的笔记链接为"https://www.xiaohongshu.com/explore/camelfeed00000000000001?xsec_token=camel-token&xsec_source=pc_search"

  场景: 卡片只有笔记编号时也能记下
    假如已有可见卡片夹具"cards-by-id.html"
    当按可见卡片刷新捕获
    那么捕获到1条笔记
    而且第1条笔记的笔记ID为"datanote00000000000001"
    而且第1条笔记的标题为"数据编号标题"
    而且第1条笔记的作者为"数据作者"

  场景: 面板可以填写要导出的条数且默认是 100
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    当渲染页内面板
    那么目标条数输入为"100"
    而且面板文案包含"目标条数"

  场景大纲: 这些条数可以直接用
    当解析导出条数"<输入>"
    那么采用条数<条数>

    例子:
      | 输入 | 条数 |
      | 100 | 100 |
      | 400 | 400 |
      | 1000 | 1000 |
      | 2000 | 2000 |

  场景大纲: 非法条数不会去要下一页
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    当按目标条数"<输入>"补齐当前列表
    那么没有继续要下一页
    而且不生成文件
    而且提示包含"请输入 1 到 2000 的整数"

    例子:
      | 输入 |
      | |
      | 0 |
      | -1 |
      | 三点五 |
      | abc |

  场景: 已经够数就不再要下一页
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    当按目标条数"2"补齐当前列表
    那么没有继续要下一页
    而且会生成文件
    而且提示包含"目标 2 条，实际 2 条"

  场景: 条数不够时沿用页面自己的搜索请求继续要，直到达到条数
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    而且后续页面依次返回"notes-more.json"
    当按目标条数"4"补齐当前列表
    那么请求了1次下一页
    而且滚动了0次
    而且下一页请求地址包含"search/notes"
    而且下一页请求体包含"\"page\":2"
    而且下一页请求体包含"sid-from-page"
    而且加载过程出现"目标 4 条，已拿到 2 条"
    而且加载过程出现"目标 4 条，已拿到 4 条"
    而且捕获到4条笔记
    而且会生成文件
    而且提示包含"目标 4 条，实际 4 条"
    当映射为Excel行并生成工作簿
    那么表头包含"作者主页"
    而且表头包含"笔记链接"

  场景: 推荐页只补推荐列表，游标用页面响应里的
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    而且已有搜索接口响应夹具"notes-feed.json"
    当把该响应作为"推荐"记入当前列表
    而且已有搜索接口响应夹具"notes-minimal.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"推荐"请求"request-homefeed.json"
    而且后续页面依次返回"notes-more.json"
    当按目标条数"4"补齐当前列表
    那么捕获到4条笔记
    而且下一页请求地址包含"/homefeed"
    而且下一页请求体包含"\"cursorScore\":\"c-next\""
    而且下一页请求体包含"\"refreshType\":3"
    而且下一页请求体包含"\"noteIndex\":2"
    而且第1条笔记的作者主页为"https://www.xiaohongshu.com/user/profile/user_1"
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    当查看当前列表
    那么捕获到0条笔记

  场景: 没有记下页面请求时改为滚动，不另造接口
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"推荐"记入当前列表
    而且后续页面依次返回"notes-more.json"
    当按目标条数"4"补齐当前列表
    那么请求了0次下一页
    而且滚动了1次
    而且捕获到4条笔记

  场景: 接口没有更多时导出已拿到的并写清条数
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic-end.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    当按目标条数"100"补齐当前列表
    那么没有继续要下一页
    而且会生成文件
    而且提示包含"目标 100 条，实际 2 条"
    而且提示包含"接口没有更多了"

  场景: 连续几次没有新笔记就停止并写清实际条数
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    而且后续页面依次返回"notes-basic.json,notes-basic.json,notes-basic.json"
    当按目标条数"10"补齐当前列表
    那么请求了3次下一页
    而且下一页没有并发
    而且相邻下一页至少间隔1000毫秒
    而且捕获到2条笔记
    而且会生成文件
    而且提示包含"目标 10 条，实际 2 条"
    而且提示包含"连续几次没有新笔记"
    而且提示不包含"实际 10 条"

  场景: 超过上限按 2000 条并告诉用户
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic-end.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    当按目标条数"4000"补齐当前列表
    那么没有继续要下一页
    而且提示包含"单次最多 2000 条"
    而且提示包含"目标 2000 条，实际 2 条"
    而且提示不包含"4000"

  场景: 补齐过程中离开当前列表就停止
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    而且后续页面依次返回"notes-more.json"
    而且补齐过程中改去"https://www.xiaohongshu.com/explore"
    当按目标条数"10"补齐当前列表
    那么不生成文件
    而且提示包含"页面已切换，已停止继续加载"
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    当查看当前列表
    那么捕获到0条笔记

  场景: 点赞数认全页面上的各种字段，0 和缺失分开
    假如已有搜索接口响应夹具"notes-likes.json"
    当解析该搜索响应
    那么第1条笔记的点赞数为"0"
    而且第2条笔记的点赞数为"6"
    而且第3条笔记的点赞数为"4"
    而且第4条笔记的点赞数为"0"
    当映射为Excel行并生成工作簿
    那么第1条数据的点赞数为"0"
    而且第4条数据的点赞数为"0"
    而且第5条数据的点赞数为""

  场景: 可见卡片上的点赞数会记下来
    假如已有可见卡片夹具"cards-likes.html"
    当按可见卡片刷新捕获
    那么第1条笔记的点赞数为"0"
    而且第2条笔记的点赞数为"9.6万"

  场景: 先看到的卡片没有点赞时，后面的接口可以补上
    假如已有可见卡片夹具"cards.html"
    当按可见卡片刷新捕获
    而且已有搜索接口响应夹具"notes-likes-late.json"
    当再解析搜索接口响应夹具"notes-likes-late.json"
    那么第1条笔记的点赞数为"0"
    而且捕获到1条笔记

  场景: 长数字游标按原文往后翻，不会停在第二页
    假如当前页面地址为"https://www.xiaohongshu.com/explore"
    而且已有搜索接口响应夹具"notes-cursor-1.json"
    当把该响应作为"推荐"记入当前列表
    而且已记下页面自己的"推荐"请求"request-cursor.json"
    而且后续页面依次返回"notes-cursor-2.json,notes-cursor-3.json"
    当按目标条数"6"补齐当前列表
    那么请求了2次下一页
    而且第1次下一页请求体包含"1793858835957003001"
    而且第2次下一页请求体包含"1793858835957003002"
    而且捕获到6条笔记
    而且提示包含"目标 6 条，实际 6 条"
    而且提示不包含"游标没有继续往后"
    而且提示不包含"连续几次没有新笔记"

  场景: 没有等到下一页时会按原来的页再要一次
    假如当前页面地址为"https://www.xiaohongshu.com/search_result?keyword=%E5%A4%A7%E5%B9%B3%E5%B1%82"
    而且已有搜索接口响应夹具"notes-basic.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    而且后续页面依次返回"notes-more.json"
    而且下一页第一次没有响应
    当按目标条数"4"补齐当前列表
    那么请求了2次下一页
    而且第1次下一页请求体包含"\"page\":2"
    而且第2次下一页请求体包含"\"page\":2"
    而且捕获到4条笔记
    而且提示不包含"连续几次没有新笔记"

  场景: 页面换掉请求方法后仍能记下搜索接口返回的笔记
    假如已有搜索接口响应夹具"notes-camel.json"
    当页面换掉请求方法后又收到该搜索响应
    那么捕获到1条笔记
    而且第1条笔记的标题为"驼峰标题"
