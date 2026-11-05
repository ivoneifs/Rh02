-- Documentos com frente e verso (RG, CNH, CTPS...): cada arquivo informa o lado (UNICO = frente e verso no mesmo arquivo).
ALTER TABLE docs_func ADD COLUMN IF NOT EXISTS lado text NOT NULL DEFAULT 'UNICO' CHECK (lado IN ('UNICO','FRENTE','VERSO'));
