export interface Program {
    name: string;
    title: string;
    image: string;
    published: boolean;
    enforce_course_order: boolean;
    enable_certification: boolean;
    certificate_template: string;
    certificate_image: string;
    program_courses: ProgramCourse[];
    program_members: ProgramMember[];
    program_schools: ProgramSchool[];
    course_count: number;
    member_count: number;
    school_count: number;
}

export interface ProgramCourse {
    course: string;
    course_title: string;
    idx: number;
    name: string;
}

export interface ProgramMember {
    member: string;
    full_name: string;
    progress: number;
    idx: number;
    name: string;
}

export interface ProgramSchool {
    school: string;
    school_title: string;
    idx: number;
    name: string;
}

export interface Programs {
    data: Program[];
    reload: () => void;
    hasNextPage: boolean;
    next: () => void;
    setValue: {
        submit: (
            data: Program,
            options?: { onSuccess?: () => void }
        ) => void;
    };
    insert: {
        submit: (
            data: Program,
            options?: { onSuccess?: () => void }
        ) => void;
    };
    delete: {
        submit: (
            name: string,
            options?: { onSuccess?: () => void }
        ) => void;
    };
}
