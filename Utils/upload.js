const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const IMAGE_DIR = path.join(__dirname, "..", "..", "frontend", "public", "images", "food-images");

// Tạo thư mục nếu chưa tồn tại
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

// Kiểm tra loại file
const fileFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Chỉ chấp nhận file ảnh định dạng JPG, JPEG, PNG"));
    }
};

// Cấu hình lưu ảnh
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, IMAGE_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName); // Đổi tên file để tránh trùng lặp
    },
});

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // Giới hạn kích thước file: 5MB
});

router.post("/upload-image", upload.single("image"), (req, res) => {
    const file = req.file;

    if (!file) {
        return res.status(400).json({ message: "Không có file được gửi lên" });
    }

    const fileName = file.filename; // Chỉ lấy tên file
    res.json({ message: "Upload thành công", filename: fileName });
});

// Xử lý lỗi upload
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // Lỗi từ multer (ví dụ: vượt quá kích thước file)
        return res.status(400).json({ message: `Lỗi upload: ${err.message}` });
    } else if (err) {
        // Lỗi khác
        return res.status(400).json({ message: `Lỗi: ${err.message}` });
    }
    next();
});

module.exports = router;
