# language: zh-CN
功能: 导出小红书搜索结果笔记

  在小红书 PC 搜索结果页，把当前页面已经加载出来的笔记导出为 Excel。
  只读取页面自己已经拿到的搜索结果，不另外请求小红书接口。

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

  场景: 页面换掉请求方法后仍能记下搜索接口返回的笔记
    假如已有搜索接口响应夹具"notes-camel.json"
    当页面换掉请求方法后又收到该搜索响应
    那么捕获到1条笔记
    而且第1条笔记的标题为"驼峰标题"
