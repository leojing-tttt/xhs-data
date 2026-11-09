# language: zh-CN
功能: 导出抖音搜索结果

  在抖音 PC 搜索结果页，按填写的条数把当前搜索里已经返回的视频导出为 Excel。
  只读取页面自己的搜索响应，不另造请求，也不把没有视频字段的条目写成一行。

  场景: 从搜索接口响应解析视频
    假如已有搜索接口响应夹具"douyin-search.json"
    当解析该搜索响应
    那么捕获到2条视频
    而且第1条视频的视频ID为"7123456789012345678"
    而且第1条视频的标题为"装修避坑"
    而且第1条视频的作者为"装修日记"
    而且第1条视频的作者ID为"10001"
    而且第1条视频的点赞数为"128"
    而且第1条视频的视频链接为"https://www.iesdouyin.com/share/video/7123456789012345678/?region=CN&mid=0&u_code=0&did=0&iid=0&with_sec_did=1&titleType=title&share_sign=fixture-sign&share_version=1&ts=1700000000&from_aid=6383&from_ssr=1"
    而且第2条视频的标题为"第二条没有分享链接"
    而且第2条视频的作者为"第二条作者"
    而且第2条视频的点赞数为"0"
    而且第2条视频的视频链接为"https://www.douyin.com/video/7000000000000000002"
    当映射为Excel行并生成工作簿
    那么表头依次为"视频ID,标题,作者,作者ID,点赞数,视频链接"
    而且数据行数为2
    而且第1行"视频ID"单元格为"7123456789012345678"
    而且第1行"视频链接"单元格为"https://www.iesdouyin.com/share/video/7123456789012345678/?region=CN&mid=0&u_code=0&did=0&iid=0&with_sec_did=1&titleType=title&share_sign=fixture-sign&share_version=1&ts=1700000000&from_aid=6383&from_ssr=1"
    而且第2行"作者ID"单元格为""
    而且第2行"点赞数"单元格为"0"
    而且第2行"视频链接"单元格为"https://www.douyin.com/video/7000000000000000002"
    而且表头不包含"评论数"
    而且表头不包含"笔记ID"
    而且工作簿工作表名为"搜索结果"
    而且工作簿首条"视频ID"为"7123456789012345678"

  场景: 没有出现过的字段不单独成列
    假如已有搜索接口响应夹具"douyin-search-minimal.json"
    当解析该搜索响应
    当映射为Excel行并生成工作簿
    那么捕获到1条视频
    而且第1条视频的标题为"只有标题"
    而且第1条视频的作者为"只有昵称"
    而且第1条视频的视频链接为"https://www.douyin.com/video/7000000000000000099"
    而且表头依次为"视频ID,标题,作者,视频链接"
    而且表头不包含"作者ID"
    而且表头不包含"点赞数"

  场景: 按页面关键词和本地时间命名文件
    假如当前页面地址为"https://www.douyin.com/search/%E8%A3%85%E4%BF%AE?type=video"
    而且本地时间为"2026-11-04 03:56"
    而且已有搜索接口响应夹具"douyin-search.json"
    当解析该搜索响应
    当用户请求导出
    那么会生成文件
    而且文件名为"抖音搜索_装修_20261104-0356.xlsx"

  场景大纲: 这些抖音地址可以导出
    假如当前页面地址为"<地址>"
    当判断扩展是否可用
    那么可以导出
    而且当前站点为"抖音"
    而且当前列表为"搜索"
    而且关键词为"<关键词>"

    例子:
      | 地址 | 关键词 |
      | https://www.douyin.com/search/%E8%A3%85%E4%BF%AE?type=video | 装修 |
      | https://www.douyin.com/search/%E8%A3%85%E4%BF%AE/ | 装修 |
      | https://douyin.com/search/%E8%A3%85%E4%BF%AE | 装修 |
      | http://www.douyin.com/search/?keyword=%E8%A3%85%E4%BF%AE | 装修 |
      | https://www.douyin.com/search | |

  场景大纲: 这些抖音地址不能导出
    假如当前页面地址为"<地址>"
    当判断扩展是否可用
    那么不可导出
    而且当前站点为"抖音"
    而且提示包含"不是抖音搜索结果页"

    例子:
      | 地址 |
      | https://www.douyin.com/ |
      | https://www.douyin.com/jingxuan |
      | https://www.douyin.com/video/7123456789012345678 |
      | https://www.douyin.com/user/MS4wLjABAAAAsample |
      | https://www.douyin.com/follow |

  场景大纲: 这些抖音搜索地址都会注入内容脚本
    当检查扩展清单是否注入"<地址>"
    那么会注入内容脚本

    例子:
      | 地址 |
      | https://www.douyin.com/search/%E8%A3%85%E4%BF%AE?type=video |
      | https://douyin.com/search/%E8%A3%85%E4%BF%AE/ |
      | http://www.douyin.com/search/?keyword=%E8%A3%85%E4%BF%AE |

  场景: 页内面板标明抖音并可以填写条数
    假如当前页面地址为"https://www.douyin.com/search/%E8%A3%85%E4%BF%AE"
    当渲染页内面板
    那么面板文案包含"抖音"
    而且面板文案包含"搜索"
    而且面板文案包含"导出搜索"
    而且面板文案包含"已捕获 0 条视频"
    而且面板包含按钮"导出 Excel"
    而且目标条数输入为"100"
    而且目标条数上限为"2000"
    而且已有搜索接口响应夹具"douyin-search.json"
    当解析该搜索响应
    当渲染页内面板
    那么面板文案包含"已捕获 2 条视频"
    而且面板文案包含"抖音"

  场景: 接口没有更多时不再滚动
    假如当前页面地址为"https://www.douyin.com/search/%E8%A3%85%E4%BF%AE"
    而且已有搜索接口响应夹具"douyin-search-minimal.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    当按目标条数"10"补齐当前列表
    那么没有继续要下一页
    而且会生成文件
    而且提示包含"接口没有更多了"
    而且提示包含"目标 10 条，实际 1 条"

  场景: 条数不够时只滚动页面，不改写页面请求
    假如当前页面地址为"https://www.douyin.com/search/%E8%A3%85%E4%BF%AE"
    而且已有搜索接口响应夹具"douyin-search.json"
    当把该响应作为"搜索"记入当前列表
    而且已记下页面自己的"搜索"请求"request-search.json"
    而且后续页面依次返回"douyin-search-more.json"
    当按目标条数"3"补齐当前列表
    那么请求了0次下一页
    而且滚动了1次
    而且捕获到3条视频
    而且第3条视频的视频链接为"https://www.iesdouyin.com/share/video/7000000000000000003/?share_sign=more-sign"

  场景: 搜索页会记下综合搜索和视频搜索响应，忽略其他接口
    假如已有搜索接口响应夹具"douyin-search.json"
    当抖音搜索页拦截到该搜索响应
    那么捕获到2条视频
    而且第1条视频的标题为"装修避坑"
