# Backend - DiTichQ1

Backend dùng FastAPI, MongoDB và HTTP nội bộ giữa các service. Đây là bản làm việc dựa trên `site-service` và `translation-service` trong thư mục BE được cung cấp; thư mục nguồn ban đầu được giữ nguyên.

## Cây thư mục

```text
BE/
├── api-gateway/                       # Cổng HTTP duy nhất cho FE
│   ├── business/                      # Điều phối request
│   ├── data/clients/                  # HTTP client gọi site-service
│   ├── presentation/                  # Public API /api/sites/*
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── site-service/                      # Sở hữu thông tin và tọa độ di tích
│   ├── business/                      # Nghiệp vụ POI, nearby và phối hợp bản dịch
│   ├── data/                          # Repository MongoDB của di tích
│   ├── integrations/                  # HTTP client gọi translation-service
│   ├── presentation/                  # Internal API /internal/sites/*
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── translation-service/               # Sở hữu bản dịch và metadata audio
│   ├── business/                      # Dịch, tạo và cache audio
│   ├── data/                          # Repository MongoDB bản dịch
│   ├── integrations/                  # Provider dịch/TTS nằm sau integration
│   ├── business/tts_engine.py         # Edge TTS và chuỗi provider dịch từ BE nhóm
│   ├── presentation/                  # Internal API /internal/audio/*
│   ├── storage/audio/                 # Audio sinh ra khi chạy
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── tests/integration/
├── docs/architecture/
├── docker-compose.yml
├── .env.example
└── .gitignore
```

## Phân lớp

Trong mỗi service, request đi theo luồng:

1. **Presentation**: FastAPI router xác thực dữ liệu vào, gọi business và trả response.
2. **Business**: quy tắc nghiệp vụ; gọi repository hoặc integration client qua dependency được khởi tạo ở `main.py`.
3. **Data**: repository sở hữu truy vấn/ghi dữ liệu của service đó.

`integrations` là adapter cho giao tiếp qua HTTP hoặc thư viện ngoài; nó không phải lớp thứ tư của nghiệp vụ. `api-gateway` không sở hữu dữ liệu, chỉ xác thực tham số công khai và điều phối request đến site service.

## Luồng FE và giao tiếp service-to-service

```text
React Web / React Native
          │ HTTP: :8000/api/sites/*
          ▼
     API Gateway
          │ HTTP nội bộ
          ▼
     Site Service ───── POST /internal/audio/{site_code} ─────► Translation Service
          │                                                           │
   district1_sites DB                                     district1_translations DB
   thông tin + tọa độ                                     bản dịch + metadata audio
                                                                      │
                                                     AI providers / Google GTX / Edge TTS
                                                                      │
                                                           audio_data volume
```

FE chỉ cấu hình base URL của gateway, ví dụ `http://localhost:8000`. Khi người dùng chọn ngôn ngữ hoặc gửi tọa độ GPS, gateway chuyển request tới site service. Site service tìm di tích; sau đó gọi translation service với mã di tích, mô tả nguồn và ngôn ngữ. Audio được dùng qua đường dẫn `/api/audio/files/...` ở gateway. Gateway và translation service đọc cùng volume audio; chỉ gateway public cổng HTTP.

## API cho FE

- `GET /api/sites/?lang=vi` — danh sách di tích; `include_audio=true` để chủ động yêu cầu tạo bản dịch/audio.
- `GET /api/sites/admin` — danh sách gồm cả di tích bản nháp dành cho trang quản trị.
- `GET /api/sites/activity` — 10 thao tác thêm/sửa/xóa di tích gần nhất, lấy từ lịch sử Backend.
- `POST /api/sites/` — thêm di tích; yêu cầu tên, mã, địa chỉ, nội dung thuyết minh và tọa độ.
- `PUT /api/sites/{site_code}` — cập nhật thông tin di tích và tọa độ.
- `DELETE /api/sites/{site_code}` — xóa vĩnh viễn một di tích theo mã.
- `GET /api/sites/nearby?lat=10.78&lng=106.70&radius_m=500&lang=vi` — di tích đang hoạt động trong bán kính, đơn vị mét.
- `POST /api/sites/sync-location` — body `{ "lat": 10.78, "lng": 106.70, "lang": "vi", "radius_m": 30 }`; trả `in_zone`, di tích và URL audio nếu ở trong geofence.
- `GET /api/sites/{site_code}/narration?lang=en` — lấy bản dịch/audio cho một điểm khi mở thuyết minh.
- `GET /api/sites/listeners/active` — số phiên nghe còn hoạt động và số phiên theo từng di tích.
- `POST /api/sites/listeners/heartbeat` — body `{ "session_id": "<UUID>", "site_code": "dinh-doc-lap" }`; tạo/cập nhật phiên nghe.
- `POST /api/sites/listeners/leave?session_id=<UUID>` — kết thúc phiên khi người dùng rời trang.
- `GET /api/audio/files/{filename}` — audio do gateway phục vụ từ volume dùng chung.
- `GET /api/audio/packs/{lang}` — manifest audio theo ngôn ngữ.
- `POST /api/auth/login` — xác thực tài khoản quản trị và cấp bearer token có thời hạn.
- `GET /health` — health check gateway.

Các route admin (`/admin`, `/activity`, CRUD và `/listeners/active`) yêu cầu bearer token khi cấu hình `ADMIN_AUTH_REQUIRED=true`. Gateway xác thực token ký HS256; token có thời hạn 8 giờ và endpoint đăng nhập khóa tạm username sau 10 lần sai trong 15 phút. Đặt `ADMIN_USERNAME`, `ADMIN_PASSWORD` (tối thiểu 12 ký tự) và `ADMIN_TOKEN_SECRET` ở môi trường triển khai, không commit chúng. `ADMIN_TOKEN_SECRET` cần tối thiểu 32 byte. Chế độ local giữ tương thích cũ nếu không bật xác thực; bật `ADMIN_AUTH_REQUIRED=true` để kiểm tra đăng nhập thật tại local.

Có thể đặt `PUBLIC_LISTENER_ONLY=true` để chủ động tắt các route admin; mặc định là `false`. Khi public dashboard có đăng nhập, giữ biến này ở `false` và bắt buộc `ADMIN_AUTH_REQUIRED=true`.

Ngôn ngữ public hiện được giới hạn ở `vi`, `en`, `ja`, `zh-CN`. Engine của nhóm có thêm ngôn ngữ giọng đọc; cần đồng bộ whitelist API trước khi mở các ngôn ngữ đó. App gửi vị trí GPS tới `sync-location` khi người dùng chọn “Tìm quanh đây”; nếu chế độ tự động bật và nằm trong geofence thì chuyển tới trang điểm di tích và phát audio. Đây chưa phải theo dõi vị trí chạy nền liên tục.

Web admin dùng endpoint catalog quản trị và có thể thêm, sửa, xóa di tích lưu trực tiếp trong MongoDB. App di động tiếp tục chỉ đọc danh sách di tích đang hoạt động và gọi narration/geofence.

Dashboard web tạo QR mở trang nghe thử tại di tích đã chọn. Mỗi tab nghe có UUID riêng, gửi heartbeat mỗi 10 giây; dashboard lấy số liệu mỗi 4 giây. Phiên được xóa khi trang gửi yêu cầu rời, và MongoDB tự loại phiên không còn heartbeat sau tối đa 60 giây (bộ đếm chỉ tính heartbeat trong 45 giây gần nhất). Để demo nhiều điện thoại cùng mạng, mở Vite bằng `npm run dev -- --host 0.0.0.0`, truy cập dashboard bằng IP LAN của máy tính để mã QR dùng đúng địa chỉ, rồi thêm đúng origin `http://<IP-LAN>:5173` vào biến `CORS_ORIGINS` trước khi chạy Docker Compose. Mỗi điện thoại quét QR và nhấn phát audio; số thiết bị trên dashboard được lấy từ MongoDB qua Gateway → Site Service, không phải số liệu hardcode trên FE.

Nếu Edge TTS tạm giới hạn yêu cầu, web vẫn tải nội dung gốc và có thể đọc bằng giọng tiếng Việt của trình duyệt. Audio server chỉ được cache khi file MP3 tồn tại và có dữ liệu; file rỗng không được phục vụ như audio hợp lệ.

## Ranh giới dữ liệu và GPS

- Chỉ `site-service` đọc/ghi hồ sơ, địa chỉ và tọa độ di tích.
- Chỉ `translation-service` đọc/ghi bản dịch và metadata audio. Service này nhận mô tả nguồn qua HTTP; không truy vấn database di tích.
- MongoDB server có thể dùng chung cho đồ án, nhưng dữ liệu nằm trong hai database riêng. Không chia sẻ repository giữa các service.
- Tọa độ lưu dưới GeoJSON Point theo thứ tự `[longitude, latitude]`; site service tạo index `2dsphere` và dùng `$near` với `$maxDistance` tính bằng mét.
- HTTP nội bộ có timeout; lỗi từ service phụ thuộc được trả thành HTTP error thay vì âm thầm trả dữ liệu thành công giả.

## Chạy bằng Docker Compose

Từ thư mục `DiTichQ1/BE`, chạy:

```sh
docker compose up --build
```

Gateway được mở tại `http://localhost:8000`; tài liệu OpenAPI tại `http://localhost:8000/docs`. Lần đầu dịch ngôn ngữ và tạo audio cần kết nối Internet. MongoDB và các service nội bộ không publish cổng ra host.

Sau khi BE chạy, nạp di tích mẫu bằng:

```sh
docker compose exec site-service python seed_sites.py
```

Để chạy web admin, khởi động Backend rồi chạy `npm run dev` trong thư mục web. Vite chuyển tiếp các request `/api` và `/health` tới `http://127.0.0.1:8000`, do đó trình duyệt và điện thoại chỉ cần truy cập cùng host của Vite; không cần cấu hình `VITE_API_URL` hoặc thêm origin của web vào `CORS_ORIGINS` cho luồng dev này. Với demo điện thoại, mở web bằng `npm run dev` (đã bind `0.0.0.0`) rồi truy cập `http://<IPv4-máy-tính>:5173`; điện thoại phải cùng mạng Wi-Fi và firewall cho phép cổng 5173. Với Expo Go, đặt `EXPO_PUBLIC_API_URL=http://<IPv4-máy-tính>:8000`; app native gọi trực tiếp Backend nên cần mạng LAN và cấu hình CORS tương ứng. Restart Expo sau khi đổi biến môi trường. Không cần API key để dịch qua các provider miễn phí; các key AI tùy chọn có thể đặt trong `BE/.env` theo `.env.example`.

## Đưa dashboard lên Render

Repo có Blueprint ở `render.yaml`: một Static Site cho toàn bộ giao diện web và một Docker Web Service miễn phí cho API Gateway, Site Service và Translation Service. Ba tiến trình backend cùng chạy trong một container; site/translation chỉ bind loopback, còn Gateway là cổng public. Audio được chia sẻ trong thư mục tạm của container và có thể được tạo lại sau khi Render khởi động lại. Atlas giữ dữ liệu di tích và bản dịch giữa các lần khởi động.

1. Tạo MongoDB Atlas M0 và database user riêng. Cấp quyền `readWrite` cho `district1_sites` và `district1_translations`, không dùng tài khoản Atlas quản trị.
2. Vì địa chỉ outbound của Render Free không cố định, Atlas Network Access cần cho phép `0.0.0.0/0`; bảo vệ kết nối bằng database user riêng với mật khẩu mạnh, không dùng mật khẩu Atlas account. Encode ký tự đặc biệt trong mật khẩu khi tạo URI.
3. Trong Render, chọn **New → Blueprint**, kết nối repo và chọn branch `project-source`. Render đọc `render.yaml`; nhập các biến được yêu cầu, đặc biệt `MONGO_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`. `ADMIN_TOKEN_SECRET` được Render tự tạo. Không gửi hoặc commit các giá trị này.
4. Chờ cả API và trang web deploy thành công. API sẽ seed 6 di tích mẫu một lần theo từng mã (không ghi đè dữ liệu đã có); trang quản trị nằm ở domain `ditichq1-web` và API dùng domain `ditichq1-api`.
5. Đăng nhập bằng tài khoản đã đặt khi tạo Blueprint. QR trên dashboard trỏ về domain web công khai; điện thoại có thể mở qua mạng bất kỳ. Gói Free có thể đưa API vào trạng thái ngủ khi không hoạt động; lần truy cập đầu sau đó có thể chậm. File audio cache có thể được tạo lại sau khi khởi động lại.

Nếu Atlas đã có dữ liệu riêng từ MongoDB local, hãy export/import dữ liệu đó trước khi dùng website; chế độ seed mẫu chỉ bổ sung mã mẫu còn thiếu và không tự chuyển dữ liệu từ máy tính.

## Phạm vi tích hợp hiện tại

Đã tích hợp Edge TTS và pipeline dịch/provider từ BE nhóm vào translation-service; nguồn nhóm được giữ nguyên. Đã bổ sung dữ liệu mẫu đồng bộ với FE mobile, endpoint geofence và narration, cùng cấu hình Expo host để điện thoại thật truy cập API host. Chưa kiểm thử end-to-end provider dịch/audio thật; cần Internet và có thể bị giới hạn từ dịch vụ miễn phí.
