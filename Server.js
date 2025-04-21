const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

const app = express();
const port = 5000;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// MongoDB connection
const uri = "mongodb+srv://hieubui2004:hieubui2004@cluster0.8gaa8yx.mongodb.net/?appName=Cluster0";
const client = new MongoClient(uri);
const dbName = "db0";
const productCollectionName = "product";
const userCollectionName = "user";

// Connect to MongoDB
async function connectToDatabase(collectionName) {
    await client.connect();
    return client.db(dbName).collection(collectionName);
}

const categoryMapping = {
    FAST: "Món ăn nhanh",
    BEVE: "Đồ uống",
    DESS: "Đồ ngọt",
    MAIN: "Món chính",
    SNAK: "Đồ ăn vặt",
    VEGE: "Đồ chay",
    COBO: "Combo",
};

/////////////////////////////////////////////////////////////////////////////////////////////

const bcrypt = require('bcrypt');
const { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken } = require('./Utils/jwtUtils');

// Middleware xác thực JWT
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token is required' });
    }

    try {
        const decoded = verifyToken(token);
        req.user = decoded; // Lưu thông tin user vào request
        next();
    } catch (error) {
        console.error("JWT verification failed:", error.message); // Log lỗi chi tiết
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Endpoint đăng nhập
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const collection = await connectToDatabase(userCollectionName);
        const user = await collection.findOne({ email });

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Tạo Access Token và Refresh Token
        const accessToken = generateToken({ id: user.id, email: user.email, role: user.role });
        const refreshToken = generateRefreshToken({ id: user.id, email: user.email });
        console.log("Access Token:", accessToken); // Log Access Token
        console.log("Refresh Token:", refreshToken); // Log Refresh Token
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: true, // Chỉ sử dụng nếu chạy HTTPS
            sameSite: 'strict',
        });

        res.status(200).json({ accessToken, refreshToken });
    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Endpoint đăng ký
app.post('/api/register', async (req, res) => {
    const { email, password, role } = req.body;

    // Kiểm tra dữ liệu đầu vào
    if (!email || !password) {
        return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });
    }

    try {
        const collection = await connectToDatabase(userCollectionName);

        // Kiểm tra xem email đã tồn tại chưa
        const existingUser = await collection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email đã được sử dụng' });
        }

        // Tạo ID người dùng mới
        const userId = await generateUserId();

        // Hash mật khẩu
        const hashedPassword = await bcrypt.hash(password, 10);

        // Tạo user mới
        const newUser = {
            id: userId, // Gắn ID tự động
            email,
            password: hashedPassword,
            role: role || 'user', // Mặc định role là 'user' nếu không được cung cấp
            created_at: new Date(),
        };

        // Lưu user vào database
        const result = await collection.insertOne(newUser);

        res.status(201).json({ message: 'Đăng ký thành công', userId: result.insertedId });
    } catch (error) {
        console.error("Register error:", error.message);
        res.status(500).json({ error: 'Đăng ký thất bại', details: error.message });
    }
});

// Endpoint refresh token
app.post('/api/refresh', async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token is required' });
    }

    try {
        const decoded = verifyRefreshToken(refreshToken);

        // Tạo Access Token mới
        const accessToken = generateToken({ id: decoded.id, email: decoded.email, role: decoded.role });
        res.status(200).json({ accessToken });
    } catch (error) {
        console.error("Refresh token error:", error.message);
        res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});

/////////////////////////////////////////////////////////////////////////////////////
const uploadRouter = require('./Utils/upload'); // Import router từ upload.js

// Sử dụng router
app.use('/api', uploadRouter); // Gắn router vào đường dẫn /api
//////////////////////////////////////////////////////////////////////////////////////
async function generateProductId(category) {
    try {
        const collection = await connectToDatabase(productCollectionName);

        // Tìm tất cả sản phẩm có chứa mã danh mục trong ID
        const lastProduct = await collection
            .find({ ID: { $regex: `^FOOD${category}` } }) // Tìm ID bắt đầu bằng FOOD + category
            .sort({ ID: -1 }) // Sắp xếp giảm dần theo ID
            .limit(1)
            .toArray();

        let lastIdNumber = 0;

        if (lastProduct.length > 0) {
            // Lấy 4 ký tự cuối của ID và chuyển thành số
            const lastId = lastProduct[0].ID;
            lastIdNumber = parseInt(lastId.slice(-4), 10);
        }

        // Tăng số thứ tự lên 1
        const newIdNumber = lastIdNumber + 1;

        // Tạo ID mới
        const newId = `FOOD${category}${newIdNumber.toString().padStart(4, "0")}`;
        return newId;
    } catch (error) {
        console.error("Lỗi khi tạo ID sản phẩm:", error);
        throw new Error("Không thể tạo ID sản phẩm");
    }
}

async function generateUserId() {
    try {
        const collection = await connectToDatabase(userCollectionName);

        // Tìm user có ID lớn nhất
        const lastUser = await collection
            .find({ id: { $regex: /^user\d{4}$/ } }) // Tìm ID bắt đầu bằng "user" và có 4 chữ số
            .sort({ id: -1 }) // Sắp xếp giảm dần theo ID
            .limit(1)
            .toArray();

        let lastIdNumber = 0;

        if (lastUser.length > 0) {
            // Lấy 4 ký tự cuối của ID và chuyển thành số
            const lastId = lastUser[0].id;
            lastIdNumber = parseInt(lastId.slice(-4), 10);
        }

        // Tăng số thứ tự lên 1
        const newIdNumber = lastIdNumber + 1;

        // Tạo ID mới
        const newId = `user${newIdNumber.toString().padStart(4, "0")}`;
        return newId;
    } catch (error) {
        console.error("Lỗi khi tạo ID người dùng:", error);
        throw new Error("Không thể tạo ID người dùng");
    }
}

// app.post('/api/products', async (req, res) => {
//     try {
//         const collection = await connectToDatabase(productCollectionName);

//         // Kiểm tra dữ liệu đầu vào
//         const { Ảnh, Tên, Cửa_Hàng, Trạng_Thái, Danh_Mục, Giá, Mô_tả } = req.body;
//         if (!Ảnh || !Tên || !Cửa_Hàng || !Trạng_Thái || !Danh_Mục || !Giá || !Mô_tả) {
//             return res.status(400).json({ error: 'Thiếu thông tin sản phẩm!' });
//         }

//         // Tạo ID tự động
//         const newId = await generateProductId(Danh_Mục);

//         // Tạo sản phẩm mới
//         const newProduct = {
//             ID: newId,
//             Ảnh, // Lưu đường dẫn ảnh hoặc tên file
//             Tên,
//             Cửa_Hàng,
//             Trạng_Thái,
//             Danh_Mục,
//             Giá: parseInt(Giá, 10), // Đảm bảo giá là số nguyên
//             Mô_tả,
//         };

//         // Lưu sản phẩm vào cơ sở dữ liệu
//         const result = await collection.insertOne(newProduct);
//         res.status(201).json({ message: 'Product created successfully', productId: result.insertedId });
//     } catch (error) {
//         console.error("Lỗi khi thêm sản phẩm:", error);
//         res.status(500).json({ error: 'Failed to create product', details: error.message });
//     }
// });

app.post('/api/products', async (req, res) => {
    try {
        const collection = await connectToDatabase(productCollectionName);

        // Kiểm tra dữ liệu đầu vào
        const { Ảnh, Tên, Cửa_Hàng, Trạng_Thái, Danh_Mục, Giá, Mô_tả } = req.body;
        if (!Ảnh || !Tên || !Cửa_Hàng || !Trạng_Thái || !Danh_Mục || !Giá || !Mô_tả) {
            return res.status(400).json({ error: 'Thiếu thông tin sản phẩm!' });
        }

        // Ánh xạ Danh_Mục từ mã sang tên đầy đủ
        const mappedCategory = categoryMapping[Danh_Mục];
        if (!mappedCategory) {
            return res.status(400).json({ error: 'Danh mục không hợp lệ!' });
        }

        // Tạo ID tự động
        const newId = await generateProductId(Danh_Mục);

        // Tạo sản phẩm mới
        const newProduct = {
            ID: newId,
            Ảnh, // Lưu đường dẫn ảnh hoặc tên file
            Tên,
            Cửa_Hàng,
            Trạng_Thái,
            Danh_Mục: mappedCategory, // Lưu tên đầy đủ của danh mục
            Giá: parseInt(Giá, 10), // Đảm bảo giá là số nguyên
            Mô_tả,
        };

        // Lưu sản phẩm vào cơ sở dữ liệu
        const result = await collection.insertOne(newProduct);
        res.status(201).json({ message: 'Product created successfully', productId: result.insertedId });
    } catch (error) {
        console.error("Lỗi khi thêm sản phẩm:", error);
        res.status(500).json({ error: 'Failed to create product', details: error.message });
    }
});

// Endpoint để lấy ID mới
app.get('/api/products/new-id', async (req, res) => {
    try {
        const category = req.query.category;
        if (!category) {
            return res.status(400).json({ error: 'Danh mục là bắt buộc' });
        }

        const newId = await generateProductId(category);
        res.status(200).json({ newId });
    } catch (error) {
        console.error("Lỗi khi tạo ID mới:", error);
        res.status(500).json({ error: 'Không thể tạo ID mới' });
    }
});

// READ: Lấy danh sách tất cả sản phẩm
app.get('/api/products', async (req, res) => {
    try {
        const collection = await connectToDatabase(productCollectionName);
        const products = await collection.find({}).toArray();
        res.status(200).json(products);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch products', details: error.message });
    }
});

// READ: Lấy thông tin một sản phẩm theo ID
app.get('/api/products/:id', async (req, res) => {
    try {
        const collection = await connectToDatabase(productCollectionName);
        const product = await collection.findOne({ ID: req.params.id });
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.status(200).json(product);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch product', details: error.message });
    }
});

// UPDATE: Cập nhật thông tin một sản phẩm theo ID
app.put('/api/products/:id', async (req, res) => {
    const { ID, Ảnh, Tên, Cửa_Hàng, Trạng_Thái, Danh_Mục, Giá, Mô_tả } = req.body;

    if (!ID || !Ảnh || !Tên || !Cửa_Hàng || !Trạng_Thái || !Danh_Mục || !Giá || !Mô_tả) {
        return res.status(400).json({ error: 'Thiếu thông tin sản phẩm!' });
    }

    try {
        const collection = await connectToDatabase(productCollectionName);
        const result = await collection.updateOne(
            { ID: req.params.id },
            { $set: { ID, Ảnh, Tên, Cửa_Hàng, Trạng_Thái, Danh_Mục, Giá, Mô_tả } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Không tìm thấy sản phẩm!' });
        }

        res.status(200).json({ message: 'Cập nhật sản phẩm thành công!' });
    } catch (error) {
        console.error("Lỗi khi cập nhật sản phẩm:", error);
        res.status(500).json({ error: 'Lỗi server', details: error.message });
    }
});

// DELETE: Xóa một sản phẩm theo ID
app.delete('/api/products/:id', async (req, res) => {
    try {
        const collection = await connectToDatabase(productCollectionName);
        const result = await collection.deleteOne({ ID: req.params.id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.status(200).json({ message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete product', details: error.message });
    }
});

// Start server
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));