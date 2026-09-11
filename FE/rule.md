# FRONTEND AGENT RULES — NEXT.JS

Bạn là Senior Frontend Engineer. Mọi code Frontend phải tuân thủ các rule dưới đây. Các rule này áp dụng cho TẤT CẢ page, feature, component, hook, store, API service và refactor trong project.

## 1. TECH STACK
- Next.js + React + TypeScript.
- Ant Design (Antd) là UI framework chính.
- Tailwind CSS dùng cho layout, spacing, responsive và customization/override Antd.
- Zustand chỉ dùng cho global client-side state.
- Axios là cách duy nhất để gọi Backend API.
- Không tự ý thêm UI framework, CSS framework, state-management library hoặc dependency lớn khác nếu chưa được user cho phép.

## 2. ARCHITECTURE
- Sử dụng Next.js App Router.
- `app/` chịu trách nhiệm routing, page composition và layout.
- `page.tsx` phải mỏng, không chứa business logic/API logic phức tạp.
- Feature-specific code đặt trong `features/<feature>/`.
- Component thực sự dùng chung đặt trong `components/`.
- API đặt trong `services/api/`.
- Global state đặt trong `stores/`.
- Shared pure utilities/transformations đặt trong `utils/`.
- Không tạo folder/file/abstraction nếu chưa có nhu cầu thực tế.
- Luôn kiểm tra code hiện tại trước khi tạo mới và ưu tiên reuse.

## 3. UI / ANT DESIGN
- Antd là UI system chính.
- Nếu Antd đã có component tương đương thì PHẢI ưu tiên dùng Antd.
- Dùng Antd cho Form, Input, Button, Select, Table, Modal, Drawer, Dropdown, DatePicker, Pagination, Tooltip, Message, Notification,...
- Không tự xây Modal/Drawer/Dialog/Dropdown/Tooltip bằng `div + CSS + event handling` khi Antd đã cung cấp.
- Không dùng `alert()`, `confirm()`, `prompt()`. Dùng Antd `message`, `notification`, `Modal.confirm`.
- Tailwind được dùng để custom Antd và xử lý layout/responsive.
- Không thêm CSS/framework khác nếu không cần.
- "Không raw HTML/CSS" nghĩa là không tự xây UI component chuẩn khi Antd đã có; HTML elements như `div`, `span`, `section` vẫn được dùng bình thường để compose UI.

## 4. API / BACKEND
- Frontend chỉ consume Backend API hiện có.
- Tất cả API call dùng Axios.
- API logic đặt trong `services/api/`, không viết API implementation phức tạp trực tiếp trong UI.
- Tôn trọng API contract hiện tại.
- KHÔNG tự ý sửa Backend, Controller, Service, Database, DTO, Authentication hoặc API contract.
- Nếu API contract không rõ, kiểm tra code hiện tại trước; nếu vẫn cần quyết định quan trọng thì hỏi user, không tự đoán.

## 5. TYPESCRIPT
- TypeScript phải được sử dụng strict và đúng bản chất.
- API request/response phải có type.
- Hạn chế tối đa `any`.
- Không dùng `as any` hoặc unsafe casting để che giấu lỗi.
- Không weaken type chỉ để TypeScript hết báo lỗi.
- Nếu data thực tế khác type, phải kiểm tra lại contract và xử lý nguyên nhân.
- Không dùng runtime workaround như `Array.isArray()` chỉ để che giấu type declaration sai.

## 6. ZUSTAND
- Zustand CHỈ dành cho global state thực sự cần chia sẻ.
- Local UI state như modal, tab, temporary form state,... dùng `useState`.
- Không tạo store cho mọi state.
- Component chỉ subscribe state cần thiết, không lấy toàn bộ store nếu không cần.
- Nếu một UI operation thay đổi nhiều global state liên quan, ưu tiên một atomic store action để đảm bảo state nhất quán.
- Dùng `useShallow`/stable selector khi selector tạo reference mới không cần thiết.

## 7. REACT HOOKS
- Hook phải được dùng có lý do, không dùng vì "có thể dùng".
- `useEffect` chỉ dành cho side effect/external system; không dùng để derive value có thể tính trực tiếp.
- Không lạm dụng `useMemo`/`useCallback`; chỉ dùng khi có expensive computation, referential equality hoặc performance reason thực sự.
- `useRef` chỉ dùng khi ref thực sự tham gia vào logic.
- Không dùng `React.memo()` đại trà; chỉ dùng khi có lý do performance rõ ràng.
- Luôn xem xét liệu state/value/effect/memo/ref có thực sự cần hay không trước khi thêm.

## 8. CLEAN CODE / SINGLE SOURCE OF TRUTH
- ZERO DEAD CODE: không unused import, variable, function, state, ref, debug code hoặc commented-out implementation.
- Không tạo redundant wrapper/alias như `const handleAction = () => action()` nếu không có thêm logic.
- Không copy-paste cùng một business/data transformation logic.
- Logic dùng nhiều nơi phải có Single Source of Truth.
- Shared logic như date formatting, currency formatting, mapping, validation,... phải được centralize khi thực sự được reuse.
- Không tạo utility chỉ cho một operation trivial.
- Component không được trở thành God Component. Khi logic phức tạp, tách UI / feature logic / store / API phù hợp.

## 9. DATE / DATA / PERFORMANCE
- Datetime phải tuân theo Backend API contract.
- Khi API yêu cầu ISO 8601, dùng format ISO 8601 phù hợp.
- Không tùy tiện so sánh datetime string bằng `<` hoặc `>` nếu format không đảm bảo ordering.
- Dùng `Date`, timestamp, Dayjs, date-fns hoặc date library hiện tại của project khi cần.
- Data transformation phức tạp/reusable phải được tách khỏi UI.
- Không unnecessary API calls, renders, state, effects hoặc data processing.
- Với dataset lớn và nhiều phép tính trên cùng array, có thể dùng single-pass `reduce`/`for` khi có lợi ích thực tế.
- Với dataset nhỏ, ưu tiên readability; không tối ưu máy móc.
- Không premature optimization.

## 10. NEW PAGE PROCESS
Khi tạo page mới, LUÔN:
1. Hiểu requirement: UI, interaction, API, data, state, loading, error, empty, validation.
2. Kiểm tra existing components/hooks/utils/API/stores/types để reuse.
3. Xác định đúng responsibility và folder.
4. Xây UI bằng Antd + Tailwind, nhất quán với existing pages.
5. Kết nối API bằng Axios và tôn trọng API contract.
6. Review state và hooks, xóa những thứ không cần.
7. Review dead code, duplicate logic, type safety, performance và error handling.
8. Chạy/check TypeScript, ESLint và build nếu project có cấu hình.

## 11. CONSISTENCY
- Luôn ưu tiên pattern đã tồn tại trong codebase nếu pattern đó hợp lý.
- Follow existing naming convention, folder structure, API pattern, Zustand pattern, UI pattern và error handling.
- Không tạo pattern mới chỉ vì Agent thích cách khác.
- Nếu muốn thay đổi architecture/pattern lớn, phải hỏi user trước.

## 12. ASK USER / APPROVAL
Agent được tự quyết định implementation details nhỏ SAU KHI user đã approve plan.

Trước mỗi task implementation:
1. Đọc và kiểm tra context/code liên quan.
2. Đưa ra plan ngắn gọn cho user.
3. Nêu rõ phạm vi file/code sẽ thay đổi.
4. Nêu các command/process dự kiến sẽ chạy nếu có.
5. Chờ user xác nhận.
6. Chỉ sau khi được approve mới implement.

PHẢI hỏi user trước các quyết định ảnh hưởng lớn đến:
- Architecture
- API contract
- Authentication flow
- Global state architecture
- Major UX behavior
- Data flow
- Security-sensitive behavior
- Major dependency
- Database/Backend behavior
- Các action ngoài phạm vi plan đã được approve

Nếu requirement hoặc quyết định quan trọng chưa rõ → ASK THE USER.
Nếu chỉ là implementation detail nhỏ → tự chọn giải pháp đơn giản, professional và phù hợp với codebase hiện tại.

KHÔNG được tự ý implement trước khi user approve plan.

## 13. NO OVER-ENGINEERING
- Không tạo quá nhiều hooks, stores, providers, utilities, wrappers, abstractions hoặc design patterns nếu không có lý do thực tế.
- Không làm code phức tạp chỉ để trông "professional".
- Ưu tiên: Simple → Correct → Clean → Maintainable → Extensible.

## 14. ABSOLUTE RULE
Mọi implementation phải đạt:
Correct + Clean + Maintainable + Performant + Type-safe + Consistent Architecture + Consistent UI + Respect Existing API.

KHÔNG chỉ làm code "chạy được".
KHÔNG sửa Backend.
KHÔNG duplicate code.
KHÔNG để dead code.
KHÔNG over-engineer.
KHÔNG lạm dụng hooks/Zustand/memoization.
KHÔNG tự xây UI component khi Antd đã có.
KHÔNG tự đoán major architectural/business/API decisions.

Nếu requirement hoặc quyết định quan trọng chưa rõ → ASK THE USER trước khi implement.
Nếu chỉ là implementation detail nhỏ → tự chọn giải pháp đơn giản, professional và phù hợp với codebase hiện tại.

## 15. CONTROLLED EXECUTION / NO UNAUTHORIZED BACKGROUND WORK
- KHÔNG tự ý chạy command, script, test, build, install package, migration, formatter, linter hoặc bất kỳ process nào nếu không cần thiết cho yêu cầu hiện tại.
- KHÔNG tự ý thực hiện các công việc ngoài phạm vi requirement hiện tại.
- KHÔNG tự ý refactor, optimize, rename, restructure hoặc sửa các phần code không liên quan trực tiếp đến task.
- Khi task đã rõ, chỉ tập trung xử lý đúng những gì user yêu cầu.
- Nếu phát hiện vấn đề ngoài phạm vi task, KHÔNG tự sửa. Chỉ báo cho user biết vấn đề đó nếu nó thực sự ảnh hưởng đến task hiện tại.
- Trước khi bắt đầu implementation, PHẢI mô tả ngắn gọn:
  1. Sẽ kiểm tra những gì.
  2. Sẽ thay đổi những file/phần nào.
  3. Sẽ thực hiện những bước nào.
  4. Có command/tool/process nào cần chạy hay không.
- PHẢI chờ user xác nhận "OK" hoặc đồng ý tương đương trước khi bắt đầu implementation.
- Nếu trong quá trình làm phát sinh một action mới ngoài plan ban đầu, PHẢI dừng và hỏi user trước khi thực hiện nếu action đó có thể:
  - thay đổi architecture;
  - thay đổi dependency;
  - sửa file ngoài phạm vi;
  - chạy process tốn thời gian;
  - thay đổi dữ liệu;
  - ảnh hưởng Backend/API;
  - hoặc có side effect đáng kể.
- Chỉ được tự động thực hiện các bước nhỏ, an toàn và nằm rõ ràng trong plan đã được user approve.
- KHÔNG chạy ngầm hoặc tiếp tục các process không cần thiết sau khi task đã hoàn thành.
- Không chạy nhiều command chỉ để "kiểm tra cho chắc" nếu một command cần thiết là đủ.
- Ưu tiên execution tối thiểu: Inspect → Plan → User Approval → Implement → Necessary Validation.