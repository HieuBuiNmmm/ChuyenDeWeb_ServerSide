const { MongoClient, ServerApiVersion } = require('mongodb');
const readline = require('readline'); // Import readline để nhận input từ terminal
const foods = require('../foods');

const uri = "mongodb+srv://hieubui2004:hieubui2004@cluster0.8gaa8yx.mongodb.net/?appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Hàm xóa toàn bộ dữ liệu
async function deleteAllDocuments() {
    try {
        await client.connect();
        const database = client.db("db0");
        const collection = database.collection("product");

        const result = await collection.deleteMany({});
        console.log(`${result.deletedCount} documents were deleted from the collection.`);
    } catch (error) {
        console.error("Error while deleting documents:", error);
    } finally {
        await client.close();
    }
}

// Hàm thêm dữ liệu
async function insertDocuments() {
    try {
        await client.connect();
        const database = client.db("db0");
        const collection = database.collection("product");

        const result = await collection.insertMany(foods);
        console.log(`${result.insertedCount} documents were inserted into the collection.`);
    } catch (error) {
        console.error("Error while inserting documents:", error);
    } finally {
        await client.close();
    }
}

// Hàm chính để chọn chức năng
function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log("Chọn chức năng:");
    console.log("1. Xóa toàn bộ dữ liệu");
    console.log("2. Thêm dữ liệu mới");

    rl.question("Nhập số chức năng bạn muốn thực hiện: ", (answer) => {
        if (answer === "1") {
            console.log("Đang thực hiện xóa toàn bộ dữ liệu...");
            deleteAllDocuments().catch(console.dir);
        } else if (answer === "2") {
            console.log("Đang thực hiện thêm dữ liệu mới...");
            insertDocuments().catch(console.dir);
        } else {
            console.log("Lựa chọn không hợp lệ. Vui lòng chạy lại chương trình.");
        }
        rl.close();
    });
}

main();