import {
  AlarmClock as LucideAlarmClock,
  AlertTriangle as LucideAlertTriangle,
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ArrowUpRight as LucideArrowUpRight,
  BadgeCheck as LucideBadgeCheck,
  Ban as LucideBan,
  Bell as LucideBell,
  Brain as LucideBrain,
  Building2 as LucideBuilding2,
  CalendarDays as LucideCalendarDays,
  Check as LucideCheck,
  CheckCircle2 as LucideCheckCircle2,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ChevronUp as LucideChevronUp,
  Circle as LucideCircle,
  CircleAlert as LucideCircleAlert,
  CircleCheck as LucideCircleCheck,
  CircleDollarSign as LucideCircleDollarSign,
  CircleSlash as LucideCircleSlash,
  ClipboardPaste as LucideClipboardPaste,
  Clock as LucideClock,
  Copy as LucideCopy,
  CopyX as LucideCopyX,
  CreditCard as LucideCreditCard,
  Cpu as LucideCpu,
  Crosshair as LucideCrosshair,
  Download as LucideDownload,
  Edit3 as LucideEdit3,
  FileText as LucideFileText,
  FileUp as LucideFileUp,
  Filter as LucideFilter,
  GraduationCap as LucideGraduationCap,
  GripVertical as LucideGripVertical,
  History as LucideHistory,
  Inbox as LucideInbox,
  Landmark as LucideLandmark,
  Layers as LucideLayers,
  LineChart as LucideLineChart,
  Link2 as LucideLink2,
  ListChecks as LucideListChecks,
  Loader2 as LucideLoader2,
  Lock as LucideLock,
  MapPin as LucideMapPin,
  Minus as LucideMinus,
  MoreHorizontal as LucideMoreHorizontal,
  MoreVertical as LucideMoreVertical,
  MousePointerClick as LucideMousePointerClick,
  PanelLeft as LucidePanelLeft,
  Pencil as LucidePencil,
  PenLine as LucidePenLine,
  Plus as LucidePlus,
  RefreshCw as LucideRefreshCw,
  Repeat as LucideRepeat,
  RotateCcw as LucideRotateCcw,
  Save as LucideSave,
  ScanLine as LucideScanLine,
  Search as LucideSearch,
  Send as LucideSend,
  Settings as LucideSettings,
  ShieldCheck as LucideShieldCheck,
  Stamp as LucideStamp,
  Table2 as LucideTable2,
  Box as LucideBox,
  Tag as LucideTag,
  Undo2 as LucideUndo2,
  UserSearch as LucideUserSearch,
  Users as LucideUsers,
  X as LucideX,
  type LucideIcon as LucideSource,
} from "lucide-react";
import { createIcon, createSpinningIcon, type Icon } from "./icon";

function wrap(Source: LucideSource, name: string): Icon {
  return createIcon(Source, name);
}

export const AlarmClock = wrap(LucideAlarmClock, "AlarmClock");
export const AlertTriangle = wrap(LucideAlertTriangle, "AlertTriangle");
export const ArrowLeft = wrap(LucideArrowLeft, "ArrowLeft");
export const ArrowRight = wrap(LucideArrowRight, "ArrowRight");
export const ArrowUpRight = wrap(LucideArrowUpRight, "ArrowUpRight");
export const BadgeCheck = wrap(LucideBadgeCheck, "BadgeCheck");
export const Ban = wrap(LucideBan, "Ban");
export const Bell = wrap(LucideBell, "Bell");
export const Box = wrap(LucideBox, "Box");
export const Brain = wrap(LucideBrain, "Brain");
export const Building2 = wrap(LucideBuilding2, "Building2");
export const CalendarDays = wrap(LucideCalendarDays, "CalendarDays");
export const Check = wrap(LucideCheck, "Check");
export const CheckCircle2 = wrap(LucideCheckCircle2, "CheckCircle2");
export const ChevronDown = wrap(LucideChevronDown, "ChevronDown");
export const ChevronLeft = wrap(LucideChevronLeft, "ChevronLeft");
export const ChevronRight = wrap(LucideChevronRight, "ChevronRight");
export const ChevronUp = wrap(LucideChevronUp, "ChevronUp");
export const Circle = wrap(LucideCircle, "Circle");
export const CircleAlert = wrap(LucideCircleAlert, "CircleAlert");
export const CircleCheck = wrap(LucideCircleCheck, "CircleCheck");
export const CircleDollarSign = wrap(LucideCircleDollarSign, "CircleDollarSign");
export const CircleSlash = wrap(LucideCircleSlash, "CircleSlash");
export const ClipboardPaste = wrap(LucideClipboardPaste, "ClipboardPaste");
export const Clock = wrap(LucideClock, "Clock");
export const Copy = wrap(LucideCopy, "Copy");
export const CopyX = wrap(LucideCopyX, "CopyX");
export const CreditCard = wrap(LucideCreditCard, "CreditCard");
export const Cpu = wrap(LucideCpu, "Cpu");
export const Crosshair = wrap(LucideCrosshair, "Crosshair");
export const Download = wrap(LucideDownload, "Download");
export const Edit3 = wrap(LucideEdit3, "Edit3");
export const FileText = wrap(LucideFileText, "FileText");
export const FileUp = wrap(LucideFileUp, "FileUp");
export const Filter = wrap(LucideFilter, "Filter");
export const GraduationCap = wrap(LucideGraduationCap, "GraduationCap");
export const GripVertical = wrap(LucideGripVertical, "GripVertical");
export const History = wrap(LucideHistory, "History");
export const Inbox = wrap(LucideInbox, "Inbox");
export const Landmark = wrap(LucideLandmark, "Landmark");
export const Layers = wrap(LucideLayers, "Layers");
export const LineChart = wrap(LucideLineChart, "LineChart");
export const Link2 = wrap(LucideLink2, "Link2");
export const ListChecks = wrap(LucideListChecks, "ListChecks");
export const Loader2 = createSpinningIcon(LucideLoader2, "Loader2");
export const Lock = wrap(LucideLock, "Lock");
export const MapPin = wrap(LucideMapPin, "MapPin");
export const Minus = wrap(LucideMinus, "Minus");
export const MoreHorizontal = wrap(LucideMoreHorizontal, "MoreHorizontal");
export const MoreVertical = wrap(LucideMoreVertical, "MoreVertical");
export const MousePointerClick = wrap(LucideMousePointerClick, "MousePointerClick");
export const PanelLeft = wrap(LucidePanelLeft, "PanelLeft");
export const Pencil = wrap(LucidePencil, "Pencil");
export const PenLine = wrap(LucidePenLine, "PenLine");
export const Plus = wrap(LucidePlus, "Plus");
export const RefreshCw = wrap(LucideRefreshCw, "RefreshCw");
export const Repeat = wrap(LucideRepeat, "Repeat");
export const RotateCcw = wrap(LucideRotateCcw, "RotateCcw");
export const Save = wrap(LucideSave, "Save");
export const ScanLine = wrap(LucideScanLine, "ScanLine");
export const Search = wrap(LucideSearch, "Search");
export const Send = wrap(LucideSend, "Send");
export const Settings = wrap(LucideSettings, "Settings");
export const ShieldCheck = wrap(LucideShieldCheck, "ShieldCheck");
export const Stamp = wrap(LucideStamp, "Stamp");
export const Table2 = wrap(LucideTable2, "Table2");
export const Tag = wrap(LucideTag, "Tag");
export const Undo2 = wrap(LucideUndo2, "Undo2");
export const UserSearch = wrap(LucideUserSearch, "UserSearch");
export const Users = wrap(LucideUsers, "Users");
export const X = wrap(LucideX, "X");

/** Lucide filename aliases used by shadcn primitives. */
export const ChevronDownIcon = ChevronDown;
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRightIcon = ChevronRight;
export const TriangleAlert = AlertTriangle;

/**
 * Domain names — prefer these in product UI so screens speak Foundry
 * vocabulary (invoice, vendor, template, approval, payment, exception).
 */
export const Invoice = FileText;
export const Vendor = Users;
export const Template = Layers;
export const Approval = Stamp;
export const Payment = Landmark;
export const Exception = AlertTriangle;
export const Analytics = LineChart;
export const Verified = BadgeCheck;
export const Warning = AlertTriangle;
export const Spinner = Loader2;
export const ClockIcon = Clock;
export const BellIcon = Bell;
export const EditIcon = Edit3;
export const FilterIcon = Filter;
export const LockIcon = Lock;
export const MapPinIcon = MapPin;
export const CopyIcon = Copy;
export const CreditCardIcon = CreditCard;
export const SaveIcon = Save;
export const TrayIcon = Box;
