# 参考图片（Reference Faces）

`scripts/audit_gifs.py` 使用这些参考图片来验证 GIF 中是否包含正确的角色人脸。

## 添加参考图片

1. 为每个角色准备一张清晰的正脸或接近正面的照片
2. 保存为 `{character}.jpg`（如 `walter.jpg`, `jesse.jpg`）
3. 放置在此目录下

## 命名规则

| 文件名 | 角色 |
|--------|------|
| `walter.jpg` | Walter White |
| `jesse.jpg` | Jesse Pinkman |
| `skyler.jpg` | Skyler White |
| `saul.jpg` | Saul Goodman |
| `mike.jpg` | Mike Ehrmantraut |
| `gus.jpg` | Gus Fring |
| `hank.jpg` | Hank Schrader |
| `marie.jpg` | Marie Schrader |

## 要求

- 格式：JPEG（`.jpg`）
- 内容：只包含一个人脸，正面或接近正面
- 质量：清晰可辨，光线均匀
- 建议：从角色的 GIF 中手动截取一张最佳帧作为参考

## 工作原理

审计脚本会：
1. 用 `face_recognition` 提取参考图片的人脸编码
2. 下载每个 GIF 的首帧并检测人脸
3. 对比两个人脸编码的 `face_distance`
4. 阈值 < 0.5 算通过