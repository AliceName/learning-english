# English Learning API

Backend ASP.NET Core Web API dùng .NET 9, Controllers và Entity Framework Core cho SQL Server.

## Chạy ứng dụng

Cài .NET SDK 9.0.307 hoặc bản vá mới hơn trong nhánh 9.0.3xx. Từ thư mục gốc repository:

```powershell
dotnet restore EnglishLearningSystem.sln
dotnet tool restore
dotnet run --project backend/EnglishLearning.Api --launch-profile http
```

Hoặc mở `EnglishLearningSystem.sln` bằng Visual Studio hỗ trợ .NET 9 và chạy project `EnglishLearning.Api`.

- Swagger UI: http://localhost:5000/swagger
- OpenAPI JSON: http://localhost:5000/openapi/v1.json
- Kiểm tra ứng dụng: `GET http://localhost:5000/api/v1/health`
- Kiểm tra SQL Server: `GET http://localhost:5000/api/v1/health/database`

API kiểm tra SQL Server trả `200` khi kết nối thành công và `503` khi thất bại. API ứng dụng không truy vấn CSDL.

## Cấu hình CSDL

`EnglishLearning.Api/appsettings.Development.json` dùng cấu hình local đã kiểm tra:

- Server: ``
- Database: `EnglishLearningDB`
- Xác thực Windows: tài khoản chạy ứng dụng phải có quyền truy cập database.

Khi chạy ngoài môi trường Development, cung cấp `ConnectionStrings__DefaultConnection` qua biến môi trường hoặc nơi lưu secrets. Không ghi mật khẩu SQL Server vào source code. `TrustServerCertificate=True` trong cấu hình Development phục vụ SQL Server local; môi trường triển khai cần cấu hình chứng chỉ phù hợp.

CORS cho phép frontend tại `http://localhost:3000`; thay đổi danh sách `Cors:AllowedOrigins` nếu frontend chạy ở địa chỉ khác. Swagger chỉ được bật trong Development.

## Dependencies .NET

Dependencies NuGet được quản lý trong `EnglishLearning.Api/EnglishLearning.Api.csproj`:

- `Microsoft.AspNetCore.Authentication.JwtBearer` 9.0.21: thư viện xác thực JWT cho bước phát triển đăng nhập.
- `Microsoft.AspNetCore.OpenApi` 9.0.21 và `Swashbuckle.AspNetCore.SwaggerUI` 9.0.6: tài liệu API và giao diện Swagger.
- `Microsoft.EntityFrameworkCore.SqlServer` 9.0.21: kết nối SQL Server qua EF Core.
- `Microsoft.EntityFrameworkCore.Design` và `Microsoft.EntityFrameworkCore.Tools` 9.0.21: công cụ thiết kế và Package Manager Console trong Visual Studio.

CLI `dotnet-ef` 9.0.21 được khai báo riêng trong `.config/dotnet-tools.json` ở thư mục gốc repository. Cài lại bằng `dotnet tool restore`, kiểm tra bằng `dotnet ef --version`. Việc restore/cài công cụ không chạy migration hoặc thay đổi CSDL.

`EnglishLearning.Api/packages.lock.json` ghi lại phiên bản NuGet đã resolve, gồm cả dependencies gián tiếp. Dùng `dotnet restore EnglishLearningSystem.sln --locked-mode` để kiểm tra việc khôi phục đúng bộ phiên bản này.

## Dependencies Python AI

`requirements.txt` tại thư mục gốc dành cho nền tảng dịch vụ AI Python. Dùng Python 3.13 và môi trường ảo riêng:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip check
```

Danh sách gồm FastAPI, Uvicorn, Pydantic Settings, Python Multipart và HTTPX. Các gói CSDL Python cũ như SQLAlchemy, Alembic và pyodbc đã được bỏ vì backend .NET quản lý SQL Server. PyTorch/CUDA, Transformers, OCR và thư viện đọc tài liệu sẽ được chọn khi triển khai engine tương ứng.

## Phạm vi project hiện tại

- Có khung API, EF Core `EnglishLearningDbContext` và kiểm tra kết nối SQL Server.
- Chưa có entity mappings, CRUD, đăng ký/đăng nhập hoặc JWT.
- Ứng dụng dùng database hiện có; không tự tạo database, bảng, dữ liệu hoặc chạy migration.
- Trước khi thêm entity hoặc migration, đối chiếu `DATABASE_SCHEMA.md`, `DATABASE_RULES.md` và schema thực tế.
- Dịch vụ Python xử lý AI sẽ được tích hợp qua HTTP ở bước phát triển tiếp theo.

## Kiểm tra build

```powershell
dotnet build EnglishLearningSystem.sln
```
