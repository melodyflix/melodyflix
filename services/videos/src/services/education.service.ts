// melodyflix videos — Education Core (Section 13.1-13.5)
// Class 1 → BCS structure: levels, subjects, chapters, topics, lessons,
// courses, enrollments, progress tracking.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type LevelKind = 'preschool' | 'class' | 'high_school' | 'undergrad' | 'postgrad' | 'diploma' | 'exam_prep' | 'vocational' | 'religious' | 'professional_cert';
export type SubjectCategory = 'language' | 'math' | 'science' | 'social' | 'religion' | 'ict' | 'business' | 'general' | 'other';
export type LessonKind = 'video' | 'pdf' | 'text' | 'live' | 'audio';
export type EnrollmentStatus = 'active' | 'completed' | 'dropped' | 'paused';
export type CourseStatus = 'draft' | 'published' | 'archived';

export interface EducationLevel {
  id: string;
  slug: string;
  name: string;
  name_bn: string | null;
  kind: LevelKind;
  numeric_order: number;
  parent_id: string | null;
  description: string | null;
  icon: string | null;
  is_active: number;
  country_code: string;      // ISO 3166 alpha-2 or 'GLOBAL'
  curriculum: string | null; // 'national' | 'cambridge' | 'ib' | 'cbse' | ...
  translations_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: string;
  slug: string;
  name: string;
  name_bn: string | null;
  category: SubjectCategory;
  description: string | null;
  icon: string | null;
  is_active: number;
  country_code: string;
  translations_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface LevelSubject {
  level_id: string;
  subject_id: string;
  is_compulsory: number;
  is_active: number;
  created_at: string;
}

export interface Chapter {
  id: string;
  level_id: string;
  subject_id: string;
  name: string;
  name_bn: string | null;
  order_index: number;
  description: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: string;
  chapter_id: string;
  name: string;
  name_bn: string | null;
  order_index: number;
  description: string | null;
  learning_objectives: string | null;  // JSON array
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Lesson {
  id: string;
  topic_id: string;
  title: string;
  kind: LessonKind;
  content_url: string | null;
  content_text: string | null;
  duration_seconds: number | null;
  order_index: number;
  is_preview: number;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  level_id: string | null;
  subject_id: string | null;
  slug: string;
  title: string;
  title_bn: string | null;
  description: string | null;
  thumbnail_url: string | null;
  status: CourseStatus;
  is_premium: number;
  price_cents: number;
  duration_hours: number;
  teacher_id: string | null;
  tags: string | null;
  created_by: string;
  country_code: string | null;
  curriculum: string | null;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  id: string;
  user_id: string;
  course_id: string | null;
  level_id: string | null;
  status: EnrollmentStatus;
  enrolled_at: string;
  completed_at: string | null;
  last_activity_at: string;
  progress_percent: number;
}

export interface LessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  completed: number;
  completed_at: string | null;
  time_spent_seconds: number;
  last_position_seconds: number;
  updated_at: string;
}

// ============================================================
// Schema
// ============================================================

export function ensureEducationSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS education_levels (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      name_bn TEXT,
      kind TEXT NOT NULL DEFAULT 'class',
      numeric_order INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      description TEXT,
      icon TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edu_level_kind ON education_levels(kind, numeric_order);
    CREATE INDEX IF NOT EXISTS idx_edu_level_parent ON education_levels(parent_id);

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      name_bn TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      description TEXT,
      icon TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subject_category ON subjects(category, is_active);

    CREATE TABLE IF NOT EXISTS level_subjects (
      level_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      is_compulsory INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      PRIMARY KEY (level_id, subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lvlsub_subject ON level_subjects(subject_id, is_active);

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      level_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_bn TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_lvlsub ON chapters(level_id, subject_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_chapter_active ON chapters(is_active);

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_bn TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      learning_objectives TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topic_chapter ON topics(chapter_id, order_index);

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'video',
      content_url TEXT,
      content_text TEXT,
      duration_seconds INTEGER,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_preview INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lesson_topic ON lessons(topic_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_lesson_kind ON lessons(kind, is_active);

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      level_id TEXT,
      subject_id TEXT,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      title TEXT NOT NULL,
      title_bn TEXT,
      description TEXT,
      thumbnail_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      is_premium INTEGER NOT NULL DEFAULT 0,
      price_cents INTEGER NOT NULL DEFAULT 0,
      duration_hours INTEGER NOT NULL DEFAULT 0,
      teacher_id TEXT,
      tags TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_course_lvlsub ON courses(level_id, subject_id, status);
    CREATE INDEX IF NOT EXISTS idx_course_teacher ON courses(teacher_id, status);

    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      course_id TEXT,
      level_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      enrolled_at TEXT NOT NULL,
      completed_at TEXT,
      last_activity_at TEXT NOT NULL,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      UNIQUE (user_id, course_id, level_id)
    );
    CREATE INDEX IF NOT EXISTS idx_enroll_user ON enrollments(user_id, status, last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_enroll_course ON enrollments(course_id, status);

    CREATE TABLE IF NOT EXISTS lesson_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      last_position_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, lesson_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lprog_user ON lesson_progress(user_id, completed);
    CREATE INDEX IF NOT EXISTS idx_lprog_lesson ON lesson_progress(lesson_id);
  `);

  // ---- Global extensions (safe migrations) ----
  try { db.exec("ALTER TABLE education_levels ADD COLUMN country_code TEXT NOT NULL DEFAULT 'GLOBAL'"); } catch {}
  try { db.exec("ALTER TABLE education_levels ADD COLUMN curriculum TEXT"); } catch {}
  try { db.exec("ALTER TABLE education_levels ADD COLUMN translations_json TEXT"); } catch {}
  try { db.exec("ALTER TABLE subjects ADD COLUMN country_code TEXT NOT NULL DEFAULT 'GLOBAL'"); } catch {}
  try { db.exec("ALTER TABLE subjects ADD COLUMN translations_json TEXT"); } catch {}
  try { db.exec("ALTER TABLE courses ADD COLUMN country_code TEXT"); } catch {}
  try { db.exec("ALTER TABLE courses ADD COLUMN curriculum TEXT"); } catch {}
  try { db.exec("ALTER TABLE courses ADD COLUMN language TEXT NOT NULL DEFAULT 'en'"); } catch {}

  // Indexes (idempotent)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_edu_level_country ON education_levels(country_code, numeric_order);
    CREATE INDEX IF NOT EXISTS idx_edu_level_curr ON education_levels(curriculum, numeric_order);
    CREATE INDEX IF NOT EXISTS idx_subject_country ON subjects(country_code, category);
  `);
}

// ============================================================
// Seed: Bangladesh education structure
// ============================================================

interface SeedLevel {
  slug: string; name: string; name_bn: string;
  kind: LevelKind; numeric_order: number; icon: string;
}

interface SeedSubject {
  slug: string; name: string; name_bn: string;
  category: SubjectCategory; icon: string;
}

const DEFAULT_LEVELS: SeedLevel[] = [
  // Primary
  { slug: 'class-1', name: 'Class 1', name_bn: 'প্রথম শ্রেণি', kind: 'class', numeric_order: 1, icon: '1️⃣' },
  { slug: 'class-2', name: 'Class 2', name_bn: 'দ্বিতীয় শ্রেণি', kind: 'class', numeric_order: 2, icon: '2️⃣' },
  { slug: 'class-3', name: 'Class 3', name_bn: 'তৃতীয় শ্রেণি', kind: 'class', numeric_order: 3, icon: '3️⃣' },
  { slug: 'class-4', name: 'Class 4', name_bn: 'চতুর্থ শ্রেণি', kind: 'class', numeric_order: 4, icon: '4️⃣' },
  { slug: 'class-5', name: 'Class 5', name_bn: 'পঞ্চম শ্রেণি', kind: 'class', numeric_order: 5, icon: '5️⃣' },
  // Secondary
  { slug: 'class-6', name: 'Class 6', name_bn: 'ষষ্ঠ শ্রেণি', kind: 'class', numeric_order: 6, icon: '6️⃣' },
  { slug: 'class-7', name: 'Class 7', name_bn: 'সপ্তম শ্রেণি', kind: 'class', numeric_order: 7, icon: '7️⃣' },
  { slug: 'class-8', name: 'Class 8', name_bn: 'অষ্টম শ্রেণি', kind: 'class', numeric_order: 8, icon: '8️⃣' },
  { slug: 'class-9', name: 'Class 9', name_bn: 'নবম শ্রেণি', kind: 'class', numeric_order: 9, icon: '9️⃣' },
  { slug: 'class-10', name: 'Class 10 (SSC)', name_bn: 'দশম শ্রেণি (এসএসসি)', kind: 'class', numeric_order: 10, icon: '🔟' },
  // Higher Secondary
  { slug: 'class-11', name: 'Class 11 (HSC)', name_bn: 'একাদশ শ্রেণি (এইচএসসি)', kind: 'class', numeric_order: 11, icon: '1️⃣1️⃣' },
  { slug: 'class-12', name: 'Class 12 (HSC)', name_bn: 'দ্বাদশ শ্রেণি (এইচএসসি)', kind: 'class', numeric_order: 12, icon: '1️⃣2️⃣' },
  // Undergrad
  { slug: 'undergrad-honours', name: 'Honours (Bachelor)', name_bn: 'অনার্স (স্নাতক)', kind: 'undergrad', numeric_order: 13, icon: '🎓' },
  { slug: 'undergrad-masters', name: 'Masters', name_bn: 'মাস্টার্স', kind: 'undergrad', numeric_order: 14, icon: '🎓' },
  // Madrasah
  { slug: 'dakhil', name: 'Dakhil', name_bn: 'দাখিল', kind: 'religious', numeric_order: 100, icon: '📖' },
  { slug: 'alim', name: 'Alim', name_bn: 'আলিম', kind: 'religious', numeric_order: 101, icon: '📖' },
  // Exam prep
  { slug: 'prep-ssc', name: 'SSC Prep', name_bn: 'এসএসসি প্রস্তুতি', kind: 'exam_prep', numeric_order: 200, icon: '📝' },
  { slug: 'prep-hsc', name: 'HSC Prep', name_bn: 'এইচএসসি প্রস্তুতি', kind: 'exam_prep', numeric_order: 201, icon: '📝' },
  { slug: 'prep-university-admission', name: 'University Admission', name_bn: 'বিশ্ববিদ্যালয় ভর্তি', kind: 'exam_prep', numeric_order: 202, icon: '🏛️' },
  { slug: 'prep-medical-admission', name: 'Medical Admission', name_bn: 'মেডিকেল ভর্তি', kind: 'exam_prep', numeric_order: 203, icon: '🩺' },
  { slug: 'prep-engineering-admission', name: 'Engineering Admission', name_bn: 'ইঞ্জিনিয়ারিং ভর্তি', kind: 'exam_prep', numeric_order: 204, icon: '⚙️' },
  { slug: 'prep-bcs', name: 'BCS', name_bn: 'বিসিএস', kind: 'exam_prep', numeric_order: 205, icon: '🏆' },
  { slug: 'prep-bank', name: 'Bank Job Prep', name_bn: 'ব্যাংক জব প্রস্তুতি', kind: 'exam_prep', numeric_order: 206, icon: '🏦' },
  { slug: 'prep-primary-teacher', name: 'Primary Teacher', name_bn: 'প্রাথমিক শিক্ষক', kind: 'exam_prep', numeric_order: 207, icon: '👨‍🏫' },
  { slug: 'prep-ntrca', name: 'NTRCA', name_bn: 'এনটিআরসিএ', kind: 'exam_prep', numeric_order: 208, icon: '📚' },
  // Vocational
  { slug: 'ssc-voc', name: 'SSC Vocational', name_bn: 'এসএসসি ভোকেশনাল', kind: 'vocational', numeric_order: 300, icon: '🔧' },
  { slug: 'hsc-voc', name: 'HSC Vocational', name_bn: 'এইচএসসি ভোকেশনাল', kind: 'vocational', numeric_order: 301, icon: '🔧' },
];

// ============================================================
// Global education levels (multi-country / multi-curriculum)
// ============================================================

interface SeedGlobalLevel {
  slug: string; name: string; kind: LevelKind;
  numeric_order: number; icon: string;
  country_code: string; curriculum: string;
  translations?: Record<string, string>;
}

const GLOBAL_LEVELS: SeedGlobalLevel[] = [
  // ============ USA ============
  { slug: 'us-preschool', name: 'Preschool (Pre-K)', kind: 'preschool', numeric_order: 1, icon: '🧸', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-kindergarten', name: 'Kindergarten', kind: 'preschool', numeric_order: 2, icon: '🎨', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g1', name: 'Grade 1', kind: 'class', numeric_order: 3, icon: '1️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g2', name: 'Grade 2', kind: 'class', numeric_order: 4, icon: '2️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g3', name: 'Grade 3', kind: 'class', numeric_order: 5, icon: '3️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g4', name: 'Grade 4', kind: 'class', numeric_order: 6, icon: '4️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g5', name: 'Grade 5', kind: 'class', numeric_order: 7, icon: '5️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g6', name: 'Grade 6 (Middle School)', kind: 'class', numeric_order: 8, icon: '6️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g7', name: 'Grade 7', kind: 'class', numeric_order: 9, icon: '7️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g8', name: 'Grade 8', kind: 'class', numeric_order: 10, icon: '8️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g9', name: 'Grade 9 (High School)', kind: 'high_school', numeric_order: 11, icon: '9️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g10', name: 'Grade 10', kind: 'high_school', numeric_order: 12, icon: '🔟', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g11', name: 'Grade 11', kind: 'high_school', numeric_order: 13, icon: '1️⃣1️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-g12', name: 'Grade 12', kind: 'high_school', numeric_order: 14, icon: '1️⃣2️⃣', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-college', name: 'College (Undergraduate)', kind: 'undergrad', numeric_order: 15, icon: '🎓', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-sat-prep', name: 'SAT Prep', kind: 'exam_prep', numeric_order: 100, icon: '📝', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-act-prep', name: 'ACT Prep', kind: 'exam_prep', numeric_order: 101, icon: '📝', country_code: 'US', curriculum: 'common_core' },
  { slug: 'us-gre-prep', name: 'GRE Prep', kind: 'exam_prep', numeric_order: 102, icon: '🎓', country_code: 'US', curriculum: 'common_core' },

  // ============ UK ============
  { slug: 'uk-ks1', name: 'Key Stage 1 (Year 1-2)', kind: 'class', numeric_order: 1, icon: '1️⃣', country_code: 'UK', curriculum: 'national_uk' },
  { slug: 'uk-ks2', name: 'Key Stage 2 (Year 3-6)', kind: 'class', numeric_order: 2, icon: '2️⃣', country_code: 'UK', curriculum: 'national_uk' },
  { slug: 'uk-ks3', name: 'Key Stage 3 (Year 7-9)', kind: 'class', numeric_order: 3, icon: '3️⃣', country_code: 'UK', curriculum: 'national_uk' },
  { slug: 'uk-gcse', name: 'GCSE (Year 10-11)', kind: 'high_school', numeric_order: 4, icon: '📘', country_code: 'UK', curriculum: 'national_uk' },
  { slug: 'uk-a-level', name: 'A-Level (Year 12-13)', kind: 'high_school', numeric_order: 5, icon: '📗', country_code: 'UK', curriculum: 'national_uk' },
  { slug: 'uk-ib', name: 'IB Diploma', kind: 'high_school', numeric_order: 6, icon: '🌐', country_code: 'UK', curriculum: 'ib' },
  { slug: 'uk-undergrad', name: 'Undergraduate', kind: 'undergrad', numeric_order: 7, icon: '🎓', country_code: 'UK', curriculum: 'national_uk' },
  { slug: 'uk-postgrad', name: 'Postgraduate', kind: 'postgrad', numeric_order: 8, icon: '🎓', country_code: 'UK', curriculum: 'national_uk' },

  // ============ India ============
  { slug: 'in-preschool', name: 'Nursery/KG', kind: 'preschool', numeric_order: 1, icon: '🧸', country_code: 'IN', curriculum: 'cbse' },
  { slug: 'in-primary', name: 'Primary (1-5)', kind: 'class', numeric_order: 2, icon: '1️⃣', country_code: 'IN', curriculum: 'cbse' },
  { slug: 'in-middle', name: 'Middle School (6-8)', kind: 'class', numeric_order: 3, icon: '6️⃣', country_code: 'IN', curriculum: 'cbse' },
  { slug: 'in-secondary', name: 'Secondary (9-10)', kind: 'high_school', numeric_order: 4, icon: '9️⃣', country_code: 'IN', curriculum: 'cbse' },
  { slug: 'in-senior', name: 'Senior Secondary (11-12)', kind: 'high_school', numeric_order: 5, icon: '1️⃣1️⃣', country_code: 'IN', curriculum: 'cbse' },
  { slug: 'in-jee', name: 'JEE (Engineering)', kind: 'exam_prep', numeric_order: 100, icon: '⚙️', country_code: 'IN', curriculum: 'cbse' },
  { slug: 'in-neet', name: 'NEET (Medical)', kind: 'exam_prep', numeric_order: 101, icon: '🩺', country_code: 'IN', curriculum: 'cbse' },
  { slug: 'in-upsc', name: 'UPSC (Civil Services)', kind: 'exam_prep', numeric_order: 102, icon: '🏛️', country_code: 'IN', curriculum: 'cbse' },

  // ============ Pakistan ============
  { slug: 'pk-primary', name: 'Primary (1-5)', kind: 'class', numeric_order: 1, icon: '1️⃣', country_code: 'PK', curriculum: 'national_pk' },
  { slug: 'pk-middle', name: 'Middle (6-8)', kind: 'class', numeric_order: 2, icon: '6️⃣', country_code: 'PK', curriculum: 'national_pk' },
  { slug: 'pk-matric', name: 'Matric (9-10)', kind: 'high_school', numeric_order: 3, icon: '9️⃣', country_code: 'PK', curriculum: 'national_pk' },
  { slug: 'pk-inter', name: 'Intermediate (11-12)', kind: 'high_school', numeric_order: 4, icon: '1️⃣1️⃣', country_code: 'PK', curriculum: 'national_pk' },

  // ============ Australia ============
  { slug: 'au-primary', name: 'Primary (F-6)', kind: 'class', numeric_order: 1, icon: '1️⃣', country_code: 'AU', curriculum: 'national_au' },
  { slug: 'au-secondary', name: 'Secondary (7-12)', kind: 'high_school', numeric_order: 2, icon: '7️⃣', country_code: 'AU', curriculum: 'national_au' },
  { slug: 'au-atars', name: 'ATAR Prep', kind: 'exam_prep', numeric_order: 100, icon: '📝', country_code: 'AU', curriculum: 'national_au' },

  // ============ Canada ============
  { slug: 'ca-elementary', name: 'Elementary (K-6)', kind: 'class', numeric_order: 1, icon: '1️⃣', country_code: 'CA', curriculum: 'national_ca' },
  { slug: 'ca-secondary', name: 'Secondary (7-12)', kind: 'high_school', numeric_order: 2, icon: '7️⃣', country_code: 'CA', curriculum: 'national_ca' },

  // ============ International / IB ============
  { slug: 'ib-pyp', name: 'IB PYP (Primary)', kind: 'class', numeric_order: 1, icon: '🌐', country_code: 'GLOBAL', curriculum: 'ib' },
  { slug: 'ib-myp', name: 'IB MYP (Middle Years)', kind: 'class', numeric_order: 2, icon: '🌐', country_code: 'GLOBAL', curriculum: 'ib' },
  { slug: 'ib-dp', name: 'IB Diploma Programme', kind: 'high_school', numeric_order: 3, icon: '🌐', country_code: 'GLOBAL', curriculum: 'ib' },
  { slug: 'cambridge-primary', name: 'Cambridge Primary', kind: 'class', numeric_order: 1, icon: '🇬🇧', country_code: 'GLOBAL', curriculum: 'cambridge' },
  { slug: 'cambridge-igcse', name: 'Cambridge IGCSE', kind: 'high_school', numeric_order: 2, icon: '🇬🇧', country_code: 'GLOBAL', curriculum: 'cambridge' },
  { slug: 'cambridge-as-a', name: 'Cambridge AS/A Level', kind: 'high_school', numeric_order: 3, icon: '🇬🇧', country_code: 'GLOBAL', curriculum: 'cambridge' },

  // ============ Professional Certs ============
  { slug: 'ielts', name: 'IELTS', kind: 'professional_cert', numeric_order: 200, icon: '🌍', country_code: 'GLOBAL', curriculum: 'cert' },
  { slug: 'toefl', name: 'TOEFL', kind: 'professional_cert', numeric_order: 201, icon: '🌍', country_code: 'GLOBAL', curriculum: 'cert' },
  { slug: 'sat', name: 'SAT (Global)', kind: 'professional_cert', numeric_order: 202, icon: '📝', country_code: 'GLOBAL', curriculum: 'cert' },
  { slug: 'aws-cert', name: 'AWS Certifications', kind: 'professional_cert', numeric_order: 210, icon: '☁️', country_code: 'GLOBAL', curriculum: 'tech' },
  { slug: 'google-cert', name: 'Google Certifications', kind: 'professional_cert', numeric_order: 211, icon: '🔍', country_code: 'GLOBAL', curriculum: 'tech' },
  { slug: 'microsoft-cert', name: 'Microsoft Certifications', kind: 'professional_cert', numeric_order: 212, icon: '💼', country_code: 'GLOBAL', curriculum: 'tech' },
  { slug: 'comptia', name: 'CompTIA (A+/Network+/Security+)', kind: 'professional_cert', numeric_order: 213, icon: '🔐', country_code: 'GLOBAL', curriculum: 'tech' },
  { slug: 'pmp', name: 'PMP (Project Management)', kind: 'professional_cert', numeric_order: 214, icon: '📊', country_code: 'GLOBAL', curriculum: 'business' },
  { slug: 'cfa', name: 'CFA (Finance)', kind: 'professional_cert', numeric_order: 215, icon: '💰', country_code: 'GLOBAL', curriculum: 'finance' },
];

// ============================================================
// Global subjects (additional, cross-country)
// ============================================================

interface SeedGlobalSubject {
  slug: string; name: string;
  category: SubjectCategory; icon: string;
  country_code: string;
}

const GLOBAL_SUBJECTS: SeedGlobalSubject[] = [
  // US-specific
  { slug: 'us-history', name: 'US History', category: 'social', icon: '🇺🇸', country_code: 'US' },
  { slug: 'us-government', name: 'US Government & Civics', category: 'social', icon: '🏛️', country_code: 'US' },
  { slug: 'ap-calculus', name: 'AP Calculus', category: 'math', icon: '📐', country_code: 'US' },
  { slug: 'ap-physics', name: 'AP Physics', category: 'science', icon: '⚛️', country_code: 'US' },
  { slug: 'ap-chemistry', name: 'AP Chemistry', category: 'science', icon: '🧪', country_code: 'US' },
  { slug: 'ap-biology', name: 'AP Biology', category: 'science', icon: '🧬', country_code: 'US' },
  { slug: 'ap-english', name: 'AP English', category: 'language', icon: '📖', country_code: 'US' },
  // UK-specific
  { slug: 'uk-history', name: 'British History', category: 'social', icon: '🇬🇧', country_code: 'UK' },
  { slug: 'uk-literature', name: 'English Literature', category: 'language', icon: '📚', country_code: 'UK' },
  { slug: 'further-math', name: 'Further Mathematics', category: 'math', icon: '📐', country_code: 'UK' },
  // India-specific
  { slug: 'hindi', name: 'Hindi', category: 'language', icon: '🇮🇳', country_code: 'IN' },
  { slug: 'indian-polity', name: 'Indian Polity', category: 'social', icon: '🏛️', country_code: 'IN' },
  { slug: 'indian-history', name: 'Indian History', category: 'social', icon: '📜', country_code: 'IN' },
  // Global / tech
  { slug: 'programming', name: 'Programming', category: 'ict', icon: '💻', country_code: 'GLOBAL' },
  { slug: 'web-development', name: 'Web Development', category: 'ict', icon: '🌐', country_code: 'GLOBAL' },
  { slug: 'data-science', name: 'Data Science', category: 'ict', icon: '📊', country_code: 'GLOBAL' },
  { slug: 'machine-learning', name: 'Machine Learning', category: 'ict', icon: '🤖', country_code: 'GLOBAL' },
  { slug: 'cybersecurity', name: 'Cybersecurity', category: 'ict', icon: '🔐', country_code: 'GLOBAL' },
  { slug: 'cloud-computing', name: 'Cloud Computing', category: 'ict', icon: '☁️', country_code: 'GLOBAL' },
  { slug: 'business-management', name: 'Business Management', category: 'business', icon: '💼', country_code: 'GLOBAL' },
  { slug: 'marketing', name: 'Marketing', category: 'business', icon: '📣', country_code: 'GLOBAL' },
  { slug: 'entrepreneurship', name: 'Entrepreneurship', category: 'business', icon: '🚀', country_code: 'GLOBAL' },
  { slug: 'digital-marketing', name: 'Digital Marketing', category: 'business', icon: '📱', country_code: 'GLOBAL' },
  { slug: 'graphic-design', name: 'Graphic Design', category: 'other', icon: '🎨', country_code: 'GLOBAL' },
  { slug: 'ui-ux-design', name: 'UI/UX Design', category: 'ict', icon: '🎨', country_code: 'GLOBAL' },
  { slug: 'photography', name: 'Photography', category: 'other', icon: '📷', country_code: 'GLOBAL' },
  { slug: 'music-theory', name: 'Music Theory', category: 'other', icon: '🎵', country_code: 'GLOBAL' },
  { slug: 'fine-arts', name: 'Fine Arts', category: 'other', icon: '🖼️', country_code: 'GLOBAL' },
  { slug: 'philosophy', name: 'Philosophy', category: 'general', icon: '🤔', country_code: 'GLOBAL' },
  { slug: 'psychology', name: 'Psychology', category: 'social', icon: '🧠', country_code: 'GLOBAL' },
  { slug: 'sociology', name: 'Sociology', category: 'social', icon: '👥', country_code: 'GLOBAL' },
  { slug: 'law', name: 'Law', category: 'social', icon: '⚖️', country_code: 'GLOBAL' },
  { slug: 'medicine', name: 'Medicine (Pre-Med)', category: 'science', icon: '🩺', country_code: 'GLOBAL' },
  { slug: 'nursing', name: 'Nursing', category: 'science', icon: '🏥', country_code: 'GLOBAL' },
  { slug: 'engineering', name: 'Engineering', category: 'science', icon: '⚙️', country_code: 'GLOBAL' },
  { slug: 'civil-engineering', name: 'Civil Engineering', category: 'science', icon: '🏗️', country_code: 'GLOBAL' },
  { slug: 'mechanical-engineering', name: 'Mechanical Engineering', category: 'science', icon: '⚙️', country_code: 'GLOBAL' },
  { slug: 'electrical-engineering', name: 'Electrical Engineering', category: 'science', icon: '⚡', country_code: 'GLOBAL' },
  { slug: 'environmental-science', name: 'Environmental Science', category: 'science', icon: '🌍', country_code: 'GLOBAL' },
  { slug: 'astronomy', name: 'Astronomy', category: 'science', icon: '🔭', country_code: 'GLOBAL' },
  { slug: 'foreign-language', name: 'Foreign Languages', category: 'language', icon: '🌐', country_code: 'GLOBAL' },
  { slug: 'french', name: 'French', category: 'language', icon: '🇫🇷', country_code: 'GLOBAL' },
  { slug: 'spanish', name: 'Spanish', category: 'language', icon: '🇪🇸', country_code: 'GLOBAL' },
  { slug: 'german', name: 'German', category: 'language', icon: '🇩🇪', country_code: 'GLOBAL' },
  { slug: 'chinese', name: 'Chinese (Mandarin)', category: 'language', icon: '🇨🇳', country_code: 'GLOBAL' },
  { slug: 'japanese', name: 'Japanese', category: 'language', icon: '🇯🇵', country_code: 'GLOBAL' },
  { slug: 'korean', name: 'Korean', category: 'language', icon: '🇰🇷', country_code: 'GLOBAL' },
  { slug: 'hindi-global', name: 'Hindi (Global)', category: 'language', icon: '🇮🇳', country_code: 'GLOBAL' },
  { slug: 'urdu', name: 'Urdu', category: 'language', icon: '🇵🇰', country_code: 'GLOBAL' },
];

// ============================================================
// Country metadata (for filtering / UI)
// ============================================================

export interface EducationCountry {
  code: string;
  name: string;
  flag: string;
  curricula: string[];
}

export const EDUCATION_COUNTRIES: EducationCountry[] = [
  { code: 'GLOBAL', name: 'Global', flag: '🌍', curricula: ['cambridge', 'ib', 'cert', 'tech', 'business', 'finance'] },
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩', curricula: ['national_bd'] },
  { code: 'US', name: 'United States', flag: '🇺🇸', curricula: ['common_core', 'ap'] },
  { code: 'UK', name: 'United Kingdom', flag: '🇬🇧', curricula: ['national_uk', 'gcse', 'a_level'] },
  { code: 'IN', name: 'India', flag: '🇮🇳', curricula: ['cbse', 'icse'] },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰', curricula: ['national_pk'] },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', curricula: ['national_au'] },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', curricula: ['national_ca'] },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', curricula: ['national_my'] },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', curricula: ['national_sg'] },
  { code: 'AE', name: 'UAE', flag: '🇦🇪', curricula: ['national_ae'] },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', curricula: ['national_sa'] },
];

const DEFAULT_SUBJECTS: SeedSubject[] = [
  // Languages
  { slug: 'bangla', name: 'Bangla', name_bn: 'বাংলা', category: 'language', icon: '🇧🇩' },
  { slug: 'english', name: 'English', name_bn: 'ইংরেজি', category: 'language', icon: '🇬🇧' },
  { slug: 'arabic', name: 'Arabic', name_bn: 'আরবি', category: 'language', icon: '🔤' },
  // Math
  { slug: 'math', name: 'Mathematics', name_bn: 'গণিত', category: 'math', icon: '➗' },
  { slug: 'higher-math', name: 'Higher Mathematics', name_bn: 'উচ্চতর গণিত', category: 'math', icon: '📐' },
  // Science
  { slug: 'science', name: 'Science', name_bn: 'বিজ্ঞান', category: 'science', icon: '🔬' },
  { slug: 'physics', name: 'Physics', name_bn: 'পদার্থবিজ্ঞান', category: 'science', icon: '⚛️' },
  { slug: 'chemistry', name: 'Chemistry', name_bn: 'রসায়ন', category: 'science', icon: '🧪' },
  { slug: 'biology', name: 'Biology', name_bn: 'জীববিজ্ঞান', category: 'science', icon: '🧬' },
  { slug: 'general-science', name: 'General Science', name_bn: 'সাধারণ বিজ্ঞান', category: 'science', icon: '🔭' },
  // ICT
  { slug: 'ict', name: 'ICT', name_bn: 'তথ্য ও যোগাযোগ প্রযুক্তি', category: 'ict', icon: '💻' },
  { slug: 'computer', name: 'Computer Science', name_bn: 'কম্পিউটার বিজ্ঞান', category: 'ict', icon: '🖥️' },
  // Social
  { slug: 'bgs', name: 'Bangladesh & Global Studies', name_bn: 'বাংলাদেশ ও বিশ্বপরিচয়', category: 'social', icon: '🌏' },
  { slug: 'history', name: 'History', name_bn: 'ইতিহাস', category: 'social', icon: '📜' },
  { slug: 'geography', name: 'Geography', name_bn: 'ভূগোল', category: 'social', icon: '🗺️' },
  { slug: 'civics', name: 'Civics', name_bn: 'পৌরনীতি', category: 'social', icon: '⚖️' },
  { slug: 'economics', name: 'Economics', name_bn: 'অর্থনীতি', category: 'social', icon: '💰' },
  { slug: 'bangladesh-affairs', name: 'Bangladesh Affairs', name_bn: 'বাংলাদেশ বিষয়াবলি', category: 'social', icon: '🇧🇩' },
  { slug: 'international-affairs', name: 'International Affairs', name_bn: 'আন্তর্জাতিক বিষয়াবলি', category: 'social', icon: '🌐' },
  // Religion
  { slug: 'islamic-studies', name: 'Islamic Studies', name_bn: 'ইসলাম শিক্ষা', category: 'religion', icon: '🕌' },
  { slug: 'hindu-religion', name: 'Hindu Religion', name_bn: 'হিন্দুধর্ম', category: 'religion', icon: '🕉️' },
  { slug: 'buddhist-religion', name: 'Buddhist Religion', name_bn: 'বৌদ্ধধর্ম', category: 'religion', icon: '☸️' },
  { slug: 'christian-religion', name: 'Christian Religion', name_bn: 'খ্রিষ্টধর্ম', category: 'religion', icon: '✝️' },
  // Business
  { slug: 'accounting', name: 'Accounting', name_bn: 'হিসাববিজ্ঞান', category: 'business', icon: '📊' },
  { slug: 'business-entrepreneurship', name: 'Business Entrepreneurship', name_bn: 'ব্যবসায় উদ্যোগ', category: 'business', icon: '💼' },
  { slug: 'finance-banking', name: 'Finance & Banking', name_bn: 'ফিন্যান্স ও ব্যাংকিং', category: 'business', icon: '🏦' },
  { slug: 'production-management', name: 'Production Management', name_bn: 'উৎপাদন ব্যবস্থাপনা', category: 'business', icon: '🏭' },
  // General / Exam prep
  { slug: 'general-knowledge', name: 'General Knowledge', name_bn: 'সাধারণ জ্ঞান', category: 'general', icon: '🧠' },
  { slug: 'mental-ability', name: 'Mental Ability', name_bn: 'মানসিক দক্ষতা', category: 'general', icon: '🧩' },
  { slug: 'mathematical-reasoning', name: 'Mathematical Reasoning', name_bn: 'গাণিতিক যুক্তি', category: 'general', icon: '🔢' },
  { slug: 'ethics', name: 'Ethics & Values', name_bn: 'নৈতিকতা ও মূল্যবোধ', category: 'general', icon: '⚖️' },
  { slug: 'agriculture', name: 'Agriculture', name_bn: 'কৃষিশিক্ষা', category: 'science', icon: '🌾' },
  { slug: 'work-life', name: 'Work & Life Oriented', name_bn: 'কর্ম ও জীবনমুখী', category: 'other', icon: '🛠️' },
  { slug: 'logic', name: 'Logic', name_bn: 'যুক্তিবিদ্যা', category: 'general', icon: '🤔' },
  { slug: 'statistics', name: 'Statistics', name_bn: 'পরিসংখ্যান', category: 'math', icon: '📈' },
];

/** Idempotent seed — inserts default levels + subjects if missing. */
export function seedEducationDefaults(): { levels_inserted: number; subjects_inserted: number } {
  const db = getDb();
  const now = new Date().toISOString();
  let lv = 0; let sub = 0;

  // -------- Bangladesh levels (country=BD, curriculum=national_bd) --------
  const insBdLevel = db.prepare(`
    INSERT OR IGNORE INTO education_levels
      (id, slug, name, name_bn, kind, numeric_order, parent_id, description, icon,
       is_active, country_code, curriculum, translations_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, 'BD', 'national_bd', NULL, ?, ?)
  `);
  for (const l of DEFAULT_LEVELS) {
    const r = insBdLevel.run(randomUUID(), l.slug, l.name, l.name_bn, l.kind, l.numeric_order, l.icon, now, now);
    if (Number(r.changes ?? 0) > 0) lv += 1;
  }

  // -------- Global levels (multi-country) --------
  const insGlobalLevel = db.prepare(`
    INSERT OR IGNORE INTO education_levels
      (id, slug, name, name_bn, kind, numeric_order, parent_id, description, icon,
       is_active, country_code, curriculum, translations_json, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, ?, 1, ?, ?, ?, ?, ?)
  `);
  for (const l of GLOBAL_LEVELS) {
    const transJson = l.translations ? JSON.stringify(l.translations) : null;
    const r = insGlobalLevel.run(randomUUID(), l.slug, l.name, l.kind, l.numeric_order,
      l.icon, l.country_code, l.curriculum, transJson, now, now);
    if (Number(r.changes ?? 0) > 0) lv += 1;
  }

  // -------- Bangladesh subjects (country=BD) --------
  const insBdSubject = db.prepare(`
    INSERT OR IGNORE INTO subjects
      (id, slug, name, name_bn, category, description, icon, is_active,
       country_code, translations_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, 1, 'BD', NULL, ?, ?)
  `);
  for (const s of DEFAULT_SUBJECTS) {
    const r = insBdSubject.run(randomUUID(), s.slug, s.name, s.name_bn, s.category, s.icon, now, now);
    if (Number(r.changes ?? 0) > 0) sub += 1;
  }

  // -------- Global subjects (cross-country) --------
  const insGlobalSubject = db.prepare(`
    INSERT OR IGNORE INTO subjects
      (id, slug, name, name_bn, category, description, icon, is_active,
       country_code, translations_json, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, NULL, ?, 1, ?, NULL, ?, ?)
  `);
  for (const s of GLOBAL_SUBJECTS) {
    const r = insGlobalSubject.run(randomUUID(), s.slug, s.name, s.category, s.icon, s.country_code, now, now);
    if (Number(r.changes ?? 0) > 0) sub += 1;
  }

  return { levels_inserted: lv, subjects_inserted: sub };
}

// ============================================================
// Levels
// ============================================================

export function listLevels(opts: { kind?: LevelKind; active_only?: boolean } = {}): EducationLevel[] {
  const db = getDb();
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.kind) { filters.push('kind = ?'); params.push(opts.kind); }
  if (opts.active_only !== false) filters.push('is_active = 1');
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return db.prepare(
    `SELECT * FROM education_levels ${where} ORDER BY numeric_order ASC`
  ).all(...params) as EducationLevel[];
}

export function getLevelByIdOrSlug(idOrSlug: string): EducationLevel | null {
  return (getDb().prepare('SELECT * FROM education_levels WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as EducationLevel | undefined) ?? null;
}

export function createLevel(input: {
  slug: string; name: string; name_bn?: string; kind: LevelKind;
  numeric_order?: number; parent_id?: string | null; description?: string | null; icon?: string | null;
}): EducationLevel {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO education_levels (id, slug, name, name_bn, kind, numeric_order, parent_id, description, icon, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.slug, input.name, input.name_bn ?? null, input.kind,
    input.numeric_order ?? 0, input.parent_id ?? null, input.description ?? null, input.icon ?? null, now, now);
  return getLevelByIdOrSlug(id)!;
}

// ============================================================
// Subjects
// ============================================================

export function listSubjects(opts: { category?: SubjectCategory; active_only?: boolean } = {}): Subject[] {
  const db = getDb();
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.category) { filters.push('category = ?'); params.push(opts.category); }
  if (opts.active_only !== false) filters.push('is_active = 1');
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM subjects ${where} ORDER BY name ASC`).all(...params) as Subject[];
}

export function getSubjectByIdOrSlug(idOrSlug: string): Subject | null {
  return (getDb().prepare('SELECT * FROM subjects WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as Subject | undefined) ?? null;
}

export function createSubject(input: {
  slug: string; name: string; name_bn?: string; category: SubjectCategory;
  description?: string | null; icon?: string | null;
}): Subject {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO subjects (id, slug, name, name_bn, category, description, icon, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.slug, input.name, input.name_bn ?? null, input.category,
    input.description ?? null, input.icon ?? null, now, now);
  return getSubjectByIdOrSlug(id)!;
}

// ============================================================
// Level ↔ Subject mapping
// ============================================================

export function linkSubjectToLevel(levelId: string, subjectId: string, isCompulsory = false): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO level_subjects (level_id, subject_id, is_compulsory, is_active, created_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(level_id, subject_id) DO UPDATE SET
      is_compulsory = excluded.is_compulsory,
      is_active = 1
  `).run(levelId, subjectId, isCompulsory ? 1 : 0, new Date().toISOString());
}

export function unlinkSubjectFromLevel(levelId: string, subjectId: string): boolean {
  const info = getDb().prepare(
    'DELETE FROM level_subjects WHERE level_id = ? AND subject_id = ?'
  ).run(levelId, subjectId);
  return Number(info.changes ?? 0) > 0;
}

export function listSubjectsForLevel(levelId: string): Array<Subject & { is_compulsory: number }> {
  return getDb().prepare(`
    SELECT s.*, ls.is_compulsory
    FROM subjects s
    INNER JOIN level_subjects ls ON ls.subject_id = s.id
    WHERE ls.level_id = ? AND ls.is_active = 1 AND s.is_active = 1
    ORDER BY ls.is_compulsory DESC, s.name ASC
  `).all(levelId) as Array<Subject & { is_compulsory: number }>;
}

export function listLevelsForSubject(subjectId: string): EducationLevel[] {
  return getDb().prepare(`
    SELECT l.* FROM education_levels l
    INNER JOIN level_subjects ls ON ls.level_id = l.id
    WHERE ls.subject_id = ? AND ls.is_active = 1 AND l.is_active = 1
    ORDER BY l.numeric_order ASC
  `).all(subjectId) as EducationLevel[];
}

// ============================================================
// Chapters
// ============================================================

export function createChapter(input: {
  level_id: string; subject_id: string;
  name: string; name_bn?: string; order_index?: number;
  description?: string | null;
}): Chapter {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const order = input.order_index ?? (db.prepare(
    'SELECT COALESCE(MAX(order_index), 0) + 1 as next FROM chapters WHERE level_id = ? AND subject_id = ?'
  ).get(input.level_id, input.subject_id) as { next: number }).next;
  db.prepare(`
    INSERT INTO chapters (id, level_id, subject_id, name, name_bn, order_index, description, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.level_id, input.subject_id, input.name, input.name_bn ?? null, order,
    input.description ?? null, now, now);
  return getChapter(id)!;
}

export function getChapter(id: string): Chapter | null {
  return (getDb().prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Chapter | undefined) ?? null;
}

export function listChapters(levelId: string, subjectId: string): Chapter[] {
  return getDb().prepare(
    'SELECT * FROM chapters WHERE level_id = ? AND subject_id = ? AND is_active = 1 ORDER BY order_index ASC'
  ).all(levelId, subjectId) as Chapter[];
}

// ============================================================
// Topics
// ============================================================

export function createTopic(input: {
  chapter_id: string;
  name: string; name_bn?: string; order_index?: number;
  description?: string | null;
  learning_objectives?: string[];
}): Topic {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const order = input.order_index ?? (db.prepare(
    'SELECT COALESCE(MAX(order_index), 0) + 1 as next FROM topics WHERE chapter_id = ?'
  ).get(input.chapter_id) as { next: number }).next;
  db.prepare(`
    INSERT INTO topics (id, chapter_id, name, name_bn, order_index, description, learning_objectives, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.chapter_id, input.name, input.name_bn ?? null, order,
    input.description ?? null,
    input.learning_objectives ? JSON.stringify(input.learning_objectives.slice(0, 50)) : null,
    now, now);
  return getTopic(id)!;
}

export function getTopic(id: string): Topic | null {
  return (getDb().prepare('SELECT * FROM topics WHERE id = ?').get(id) as Topic | undefined) ?? null;
}

export function listTopics(chapterId: string): Topic[] {
  return getDb().prepare(
    'SELECT * FROM topics WHERE chapter_id = ? AND is_active = 1 ORDER BY order_index ASC'
  ).all(chapterId) as Topic[];
}

// ============================================================
// Lessons
// ============================================================

export function createLesson(input: {
  topic_id: string;
  title: string;
  kind?: LessonKind;
  content_url?: string | null;
  content_text?: string | null;
  duration_seconds?: number | null;
  order_index?: number;
  is_preview?: boolean;
  created_by: string;
}): Lesson {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const order = input.order_index ?? (db.prepare(
    'SELECT COALESCE(MAX(order_index), 0) + 1 as next FROM lessons WHERE topic_id = ?'
  ).get(input.topic_id) as { next: number }).next;
  db.prepare(`
    INSERT INTO lessons (id, topic_id, title, kind, content_url, content_text, duration_seconds, order_index, is_preview, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, input.topic_id, input.title, input.kind ?? 'video',
    input.content_url ?? null, input.content_text ?? null,
    input.duration_seconds ?? null, order, input.is_preview ? 1 : 0,
    input.created_by, now, now);
  return getLesson(id)!;
}

export function getLesson(id: string): Lesson | null {
  return (getDb().prepare('SELECT * FROM lessons WHERE id = ?').get(id) as Lesson | undefined) ?? null;
}

export function listLessons(topicId: string): Lesson[] {
  return getDb().prepare(
    'SELECT * FROM lessons WHERE topic_id = ? AND is_active = 1 ORDER BY order_index ASC'
  ).all(topicId) as Lesson[];
}

// ============================================================
// Courses
// ============================================================

export function createCourse(input: {
  title: string; title_bn?: string; slug?: string;
  level_id?: string | null; subject_id?: string | null;
  description?: string | null; thumbnail_url?: string | null;
  is_premium?: boolean; price_cents?: number;
  duration_hours?: number;
  teacher_id?: string | null;
  tags?: string[];
  created_by: string;
  country_code?: string | null;
  curriculum?: string | null;
  language?: string;
}): Course {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  let slug = (input.slug ?? input.title.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').slice(0, 80)) || 'course';
  let attempts = 0;
  while (db.prepare('SELECT 1 FROM courses WHERE slug = ?').get(slug)) {
    attempts += 1;
    slug = `${slug}-${attempts}`;
    if (attempts > 100) throw new Error('Cannot generate unique slug');
  }
  db.prepare(`
    INSERT INTO courses (id, level_id, subject_id, slug, title, title_bn, description,
      thumbnail_url, status, is_premium, price_cents, duration_hours, teacher_id, tags,
      created_by, country_code, curriculum, language, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.level_id ?? null, input.subject_id ?? null, slug, input.title,
    input.title_bn ?? null, input.description ?? null, input.thumbnail_url ?? null,
    input.is_premium ? 1 : 0, input.price_cents ?? 0, input.duration_hours ?? 0,
    input.teacher_id ?? null,
    input.tags ? JSON.stringify(input.tags.slice(0, 20)) : null,
    input.created_by,
    input.country_code ?? null, input.curriculum ?? null, input.language ?? 'en',
    now, now);
  return getCourse(id)!;
}

export function getCourse(idOrSlug: string): Course | null {
  return (getDb().prepare('SELECT * FROM courses WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as Course | undefined) ?? null;
}

export function listCourses(opts: {
  level_id?: string; subject_id?: string; status?: CourseStatus;
  teacher_id?: string; limit?: number; offset?: number;
} = {}): Course[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.level_id) { filters.push('level_id = ?'); params.push(opts.level_id); }
  if (opts.subject_id) { filters.push('subject_id = ?'); params.push(opts.subject_id); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  if (opts.teacher_id) { filters.push('teacher_id = ?'); params.push(opts.teacher_id); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.prepare(
    `SELECT * FROM courses ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as Course[];
}

export function updateCourseStatus(id: string, status: CourseStatus, requesterId: string, isAdmin: boolean): Course {
  const course = getCourse(id);
  if (!course) throw new Error('Course not found');
  if (!isAdmin && course.created_by !== requesterId && course.teacher_id !== requesterId) {
    throw new Error('Not authorized');
  }
  const now = new Date().toISOString();
  getDb().prepare('UPDATE courses SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  return getCourse(id)!;
}

// ============================================================
// Enrollments
// ============================================================

export function enroll(input: {
  user_id: string;
  course_id?: string | null;
  level_id?: string | null;
}): Enrollment {
  if (!input.course_id && !input.level_id) throw new Error('course_id or level_id required');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT * FROM enrollments WHERE user_id = ? AND course_id IS ? AND level_id IS ?'
  ).get(input.user_id, input.course_id ?? null, input.level_id ?? null) as Enrollment | undefined;
  if (existing) return existing;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO enrollments (id, user_id, course_id, level_id, status, enrolled_at, completed_at, last_activity_at, progress_percent)
    VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, 0)
  `).run(id, input.user_id, input.course_id ?? null, input.level_id ?? null, now, now);
  return getEnrollment(id)!;
}

export function getEnrollment(id: string): Enrollment | null {
  return (getDb().prepare('SELECT * FROM enrollments WHERE id = ?').get(id) as Enrollment | undefined) ?? null;
}

export function listUserEnrollments(userId: string): Enrollment[] {
  return getDb().prepare(
    'SELECT * FROM enrollments WHERE user_id = ? ORDER BY last_activity_at DESC'
  ).all(userId) as Enrollment[];
}

export function updateEnrollmentProgress(enrollmentId: string, percent: number): Enrollment {
  const db = getDb();
  const now = new Date().toISOString();
  const clamped = Math.min(Math.max(Math.round(percent), 0), 100);
  const status = clamped >= 100 ? 'completed' : 'active';
  const completedAt = clamped >= 100 ? now : null;
  db.prepare(`
    UPDATE enrollments SET progress_percent = ?, status = ?, completed_at = COALESCE(?, completed_at), last_activity_at = ?
    WHERE id = ?
  `).run(clamped, status, completedAt, now, enrollmentId);
  return getEnrollment(enrollmentId)!;
}

// ============================================================
// Lesson Progress
// ============================================================

export function markLessonProgress(input: {
  user_id: string;
  lesson_id: string;
  completed?: boolean;
  time_spent_seconds?: number;
  last_position_seconds?: number;
}): LessonProgress {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?'
  ).get(input.user_id, input.lesson_id) as LessonProgress | undefined;

  if (existing) {
    const completed = input.completed === true ? 1 : existing.completed;
    const completedAt = completed === 1 ? (existing.completed_at ?? now) : null;
    db.prepare(`
      UPDATE lesson_progress SET completed = ?, completed_at = ?,
        time_spent_seconds = time_spent_seconds + ?,
        last_position_seconds = COALESCE(?, last_position_seconds),
        updated_at = ?
      WHERE id = ?
    `).run(completed, completedAt, input.time_spent_seconds ?? 0,
      input.last_position_seconds ?? null, now, existing.id);
    return db.prepare('SELECT * FROM lesson_progress WHERE id = ?').get(existing.id) as LessonProgress;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO lesson_progress (id, user_id, lesson_id, completed, completed_at, time_spent_seconds, last_position_seconds, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.user_id, input.lesson_id,
    input.completed ? 1 : 0, input.completed ? now : null,
    input.time_spent_seconds ?? 0, input.last_position_seconds ?? 0, now);
  return db.prepare('SELECT * FROM lesson_progress WHERE id = ?').get(id) as LessonProgress;
}

export function listLessonProgress(userId: string, lessonIds: string[]): LessonProgress[] {
  if (lessonIds.length === 0) return [];
  const placeholders = lessonIds.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id IN (${placeholders})`
  ).all(userId, ...lessonIds) as LessonProgress[];
}

export interface TopicProgressSummary {
  topic_id: string;
  total_lessons: number;
  completed_lessons: number;
  percent: number;
}

export function getTopicProgress(userId: string, topicId: string): TopicProgressSummary {
  const db = getDb();
  const lessons = listLessons(topicId);
  if (lessons.length === 0) return { topic_id: topicId, total_lessons: 0, completed_lessons: 0, percent: 0 };
  const ids = lessons.map((l) => l.id);
  const placeholders = ids.map(() => '?').join(',');
  const completed = (db.prepare(
    `SELECT COUNT(*) as n FROM lesson_progress WHERE user_id = ? AND completed = 1 AND lesson_id IN (${placeholders})`
  ).get(userId, ...ids) as { n: number }).n;
  return {
    topic_id: topicId,
    total_lessons: lessons.length,
    completed_lessons: completed,
    percent: Math.round((completed / lessons.length) * 100),
  };
}

// ============================================================
// Browse helpers (public)
// ============================================================

export interface LevelBrowse {
  level: EducationLevel;
  subjects: Array<Subject & { is_compulsory: number; chapter_count: number; course_count: number }>;
}

export function browseLevel(levelIdOrSlug: string): LevelBrowse | null {
  const level = getLevelByIdOrSlug(levelIdOrSlug);
  if (!level) return null;
  const subjects = listSubjectsForLevel(level.id);
  const db = getDb();
  const enriched = subjects.map((s) => {
    const chapterCount = (db.prepare(
      'SELECT COUNT(*) as n FROM chapters WHERE level_id = ? AND subject_id = ? AND is_active = 1'
    ).get(level.id, s.id) as { n: number }).n;
    const courseCount = (db.prepare(
      "SELECT COUNT(*) as n FROM courses WHERE level_id = ? AND subject_id = ? AND status = 'published'"
    ).get(level.id, s.id) as { n: number }).n;
    return { ...s, chapter_count: chapterCount, course_count: courseCount };
  });
  return { level, subjects: enriched };
}

export interface SubjectBrowse {
  subject: Subject;
  levels: Array<EducationLevel & { chapter_count: number; course_count: number }>;
}

export function browseSubject(subjectIdOrSlug: string): SubjectBrowse | null {
  const subject = getSubjectByIdOrSlug(subjectIdOrSlug);
  if (!subject) return null;
  const levels = listLevelsForSubject(subject.id);
  const db = getDb();
  const enriched = levels.map((l) => {
    const chapterCount = (db.prepare(
      'SELECT COUNT(*) as n FROM chapters WHERE level_id = ? AND subject_id = ? AND is_active = 1'
    ).get(l.id, subject.id) as { n: number }).n;
    const courseCount = (db.prepare(
      "SELECT COUNT(*) as n FROM courses WHERE level_id = ? AND subject_id = ? AND status = 'published'"
    ).get(l.id, subject.id) as { n: number }).n;
    return { ...l, chapter_count: chapterCount, course_count: courseCount };
  });
  return { subject, levels: enriched };
}
