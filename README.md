# 情绪练习

一个给自己用的情绪练习小站，可以加到 iPhone 主屏幕上。没有网络时也能打开。

练习包括：快要发火时的 STOP 和三分钟呼吸空间、每日情绪打卡、思维记录，以及八周练习勾选。表的内容来自 `worksheets.json`，打印版是 `emotion-worksheets.pdf`。

## 数据在哪里

记录只保存在你自己的手机里（浏览器的本地存储）。页面没有服务器，也不会统计访问，不会把内容发出去。

换浏览器、清除网站数据，或者换手机，记录会消失。可以在「关于」里导出 JSON 备份，也可以再导入。删除全部记录前会再问一次。

在 iPhone 上，Safari 里的记录和「添加到主屏幕」之后的图标，有时不是同一份。常用哪一种，就在那一种里导出。

## 加到主屏幕

1. 用 iPhone 的 **Safari** 打开 [https://garywang0101.github.io/mood-practice/](https://garywang0101.github.io/mood-practice/)
2. 点底部的分享按钮
3. 选择「添加到主屏幕」
4. 名称会显示为「情绪练习」

第一次打开需要联网。之后可以离线使用。

安卓可以用 Chrome 菜单里的「添加到主屏幕」或「安装应用」。

## 请先知道

这些练习整理自公开自助书的读书笔记，只供自己练习，**不能代替医生或心理咨询师**。

如果出现伤害自己的念头，或者觉得撑不下去了，请联系身边的人，或打下面的电话：

- 北京心理危机研究与干预中心 010-82951332
- 全国心理援助热线 400-161-9995

## 本地打开

在仓库目录执行：

```bash
python3 -m http.server
```

浏览器访问 `http://127.0.0.1:8000/`。不要直接双击打开 `index.html`，否则浏览器会拦住本地脚本。

## 发布

站点文件在仓库根目录，并带有 `.nojekyll`，给 GitHub Pages 用。

设置路径：仓库 Settings → Pages → Build and deployment → Source 选 **Deploy from a branch**，Branch 选 `main`，文件夹选 **`/ (root)`**。

打开后的地址是 `https://garywang0101.github.io/mood-practice/`。
