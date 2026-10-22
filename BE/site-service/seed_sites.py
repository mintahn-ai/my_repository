import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient

SITES = [
    {
        "code": "dinh-doc-lap",
        "name": "Dinh Độc Lập",
        "category": "Lịch sử",
        "address": "135 Nam Kỳ Khởi Nghĩa",
        "lat": 10.7769,
        "lng": 106.6952,
        "description": (
            "Giữa lòng thành phố, Dinh Độc Lập lưu giữ những lát cắt quan trọng "
            "của lịch sử hiện đại Việt Nam. Công trình được khởi công năm 1962 "
            "theo thiết kế của kiến trúc sư Ngô Viết Thụ, kết hợp đường nét hiện "
            "đại với những biểu tượng Á Đông. Mỗi căn phòng, hành lang và khu "
            "vườn nơi đây đều kể lại một câu chuyện về thời gian, biến động và "
            "ngày đất nước thống nhất."
        ),
    },
    {
        "code": "nha-tho-duc-ba",
        "name": "Nhà thờ Đức Bà",
        "category": "Kiến trúc",
        "address": "01 Công xã Paris",
        "lat": 10.7798,
        "lng": 106.6991,
        "description": (
            "Vương cung thánh đường Đức Bà Sài Gòn là một điểm nhấn kiến trúc "
            "nổi bật giữa trung tâm thành phố. Công trình được xây dựng vào "
            "cuối thế kỷ XIX với vật liệu đưa từ Pháp sang, nổi bật bởi hai tháp "
            "chuông vươn cao và sắc gạch đỏ đặc trưng. Qua hơn một thế kỷ, nơi "
            "đây vẫn là điểm hẹn thân quen của người dân và du khách."
        ),
    },
    {
        "code": "buudien-trung-tam",
        "name": "Bưu điện Trung tâm",
        "category": "Kiến trúc",
        "address": "02 Công xã Paris",
        "lat": 10.7797,
        "lng": 106.7009,
        "description": (
            "Bưu điện Trung tâm Thành phố Hồ Chí Minh gây ấn tượng với mái vòm "
            "rộng, khung thép trang trí và những ô cửa cao ngập ánh sáng. Công "
            "trình gắn với giai đoạn đô thị Sài Gòn phát triển mạnh vào cuối "
            "thế kỷ XIX. Bên trong, bản đồ thành phố xưa vẫn nhắc nhớ về một "
            "thời kỳ giao thương sôi động."
        ),
    },
    {
        "code": "bao-tang-tphcm",
        "name": "Bảo tàng TP. Hồ Chí Minh",
        "category": "Bảo tàng",
        "address": "65 Lý Tự Trọng",
        "lat": 10.7767,
        "lng": 106.6999,
        "description": (
            "Tọa lạc trong một dinh thự cổ mang phong cách châu Âu, Bảo tàng "
            "Thành phố Hồ Chí Minh lưu giữ câu chuyện về vùng đất Sài Gòn – "
            "Gia Định qua nhiều thời kỳ. Các phòng trưng bày đưa người xem đi "
            "từ địa lý, khảo cổ, thương cảng đến đời sống đô thị hôm nay."
        ),
    },
    {
        "code": "nha-hat-thanh-pho",
        "name": "Nhà hát Thành phố",
        "category": "Văn hóa",
        "address": "07 Công trường Lam Sơn",
        "lat": 10.7766,
        "lng": 106.7030,
        "description": (
            "Nhà hát Thành phố là một trong những công trình kiến trúc tiêu "
            "biểu ở trung tâm Sài Gòn. Mặt tiền giàu chi tiết trang trí, những "
            "bậc thềm rộng và không gian biểu diễn bên trong tạo nên một điểm "
            "gặp gỡ giữa nghệ thuật và đời sống đô thị."
        ),
    },
    {
        "code": "ben-nha-rong",
        "name": "Bến Nhà Rồng",
        "category": "Lịch sử",
        "address": "01 Nguyễn Tất Thành",
        "lat": 10.7683,
        "lng": 106.7067,
        "description": (
            "Bến Nhà Rồng là địa điểm gắn với hành trình ra đi tìm đường cứu "
            "nước của Nguyễn Tất Thành năm 1911. Công trình bên sông Sài Gòn "
            "được xây dựng đầu thế kỷ XX, nổi bật với kiến trúc kết hợp phong "
            "cách phương Tây và các chi tiết trang trí phương Đông. Ngày nay, "
            "nơi đây là Bảo tàng Hồ Chí Minh - chi nhánh Thành phố Hồ Chí Minh."
        ),
    },
]


async def main() -> None:
    client = AsyncIOMotorClient(
        os.getenv("MONGO_URL", "mongodb://localhost:27017"),
        serverSelectionTimeoutMS=5000,
    )
    try:
        collection = client[
            os.getenv("SITE_DATABASE", "district1_sites")
        ]["sites"]
        await collection.create_index("code", unique=True)
        await collection.create_index([("location", "2dsphere")])
        for site in SITES:
            document = {
                **site,
                "is_active": True,
                "location": {
                    "type": "Point",
                    "coordinates": [site["lng"], site["lat"]],
                },
            }
            await collection.update_one(
                {"code": site["code"]},
                {"$setOnInsert": document},
                upsert=True,
            )
        print(f"Seeded {len(SITES)} sample historic sites (existing records preserved).")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
