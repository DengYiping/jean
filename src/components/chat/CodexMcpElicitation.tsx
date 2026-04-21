import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Markdown } from '@/components/ui/markdown'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { CodexMcpElicitation } from '@/types/chat'

type PrimitiveFieldSchema =
  | {
      type: 'string'
      title?: string | null
      description?: string | null
      default?: string | null
      minLength?: number | null
      maxLength?: number | null
      enum?: string[]
      enumNames?: string[] | null
      oneOf?: { const: string; title: string }[]
    }
  | {
      type: 'number'
      title?: string | null
      description?: string | null
      default?: number | null
      minimum?: number | null
      maximum?: number | null
    }
  | {
      type: 'boolean'
      title?: string | null
      description?: string | null
      default?: boolean | null
    }
  | {
      type: 'array'
      title?: string | null
      description?: string | null
      default?: string[] | null
      minItems?: number | null
      maxItems?: number | null
      items?:
        | { enum?: string[]; type?: 'string' }
        | { anyOf?: { const: string; title: string }[] }
    }

interface FormSchema {
  type?: 'object'
  properties?: Record<string, PrimitiveFieldSchema>
  required?: string[]
}

export interface CodexMcpElicitationProps {
  sessionId: string
  elicitation: CodexMcpElicitation
  onRespond: (
    sessionId: string,
    rpcId: number,
    action: 'accept' | 'decline' | 'cancel',
    content: Record<string, unknown> | null
  ) => void
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringFieldSchema(
  schema: PrimitiveFieldSchema
): schema is Extract<PrimitiveFieldSchema, { type: 'string' }> {
  return schema.type === 'string'
}

function isArrayFieldSchema(
  schema: PrimitiveFieldSchema
): schema is Extract<PrimitiveFieldSchema, { type: 'array' }> {
  return schema.type === 'array'
}

function hasEnumItems(items: unknown): items is {
  enum?: string[]
  type?: 'string'
} {
  return isObject(items)
}

function hasAnyOfItems(items: unknown): items is {
  anyOf?: { const: string; title: string }[]
} {
  return isObject(items)
}

function asFormSchema(schema: unknown): FormSchema {
  if (!isObject(schema)) {
    return { type: 'object', properties: {} }
  }

  return {
    type: schema.type === 'object' ? 'object' : undefined,
    properties: isObject(schema.properties)
      ? (schema.properties as Record<string, PrimitiveFieldSchema>)
      : {},
    required: Array.isArray(schema.required)
      ? schema.required.filter(
          (fieldName): fieldName is string => typeof fieldName === 'string'
        )
      : [],
  }
}

function getFieldLabel(
  fieldName: string,
  schema: PrimitiveFieldSchema
): string {
  return schema.title ?? fieldName
}

function getStringOptions(
  schema: PrimitiveFieldSchema
): { value: string; label: string }[] {
  if (isArrayFieldSchema(schema)) {
    const itemSchema = schema.items
    if (hasAnyOfItems(itemSchema) && Array.isArray(itemSchema.anyOf)) {
      return itemSchema.anyOf
        .filter(
          (
            option
          ): option is {
            const: string
            title: string
          } => isObject(option) && typeof option.const === 'string'
        )
        .map(option => ({
          value: option.const,
          label: option.title,
        }))
    }
    if (hasEnumItems(itemSchema) && Array.isArray(itemSchema.enum)) {
      return itemSchema.enum
        .filter((option): option is string => typeof option === 'string')
        .map(option => ({
          value: option,
          label: option,
        }))
    }
    return []
  }

  if (isStringFieldSchema(schema) && Array.isArray(schema.oneOf)) {
    return schema.oneOf
      .filter(
        (
          option
        ): option is {
          const: string
          title: string
        } =>
          isObject(option) &&
          typeof option.const === 'string' &&
          typeof option.title === 'string'
      )
      .map(option => ({
        value: option.const,
        label: option.title,
      }))
  }

  if (isStringFieldSchema(schema) && Array.isArray(schema.enum)) {
    return schema.enum.map((value, index) => ({
      value,
      label: schema.enumNames?.[index] ?? value,
    }))
  }

  return []
}

function buildInitialValues(schema: FormSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [fieldName, fieldSchema] of Object.entries(
    schema.properties ?? {}
  )) {
    switch (fieldSchema.type) {
      case 'string':
        values[fieldName] = fieldSchema.default ?? ''
        break
      case 'number':
        values[fieldName] =
          typeof fieldSchema.default === 'number'
            ? String(fieldSchema.default)
            : ''
        break
      case 'boolean':
        values[fieldName] = fieldSchema.default ?? false
        break
      case 'array':
        values[fieldName] = fieldSchema.default ?? []
        break
    }
  }
  return values
}

function buildValidationErrors(
  schema: FormSchema,
  values: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {}
  const requiredFields = new Set(schema.required ?? [])

  for (const [fieldName, fieldSchema] of Object.entries(
    schema.properties ?? {}
  )) {
    const value = values[fieldName]

    switch (fieldSchema.type) {
      case 'string': {
        const text = typeof value === 'string' ? value : ''
        if (requiredFields.has(fieldName) && text.trim().length === 0) {
          errors[fieldName] = 'Required'
          break
        }
        if (
          typeof fieldSchema.minLength === 'number' &&
          text.length < fieldSchema.minLength
        ) {
          errors[fieldName] =
            `Must be at least ${fieldSchema.minLength} characters`
          break
        }
        if (
          typeof fieldSchema.maxLength === 'number' &&
          text.length > fieldSchema.maxLength
        ) {
          errors[fieldName] =
            `Must be at most ${fieldSchema.maxLength} characters`
        }
        break
      }
      case 'number': {
        const text = typeof value === 'string' ? value : ''
        if (requiredFields.has(fieldName) && text.trim().length === 0) {
          errors[fieldName] = 'Required'
          break
        }
        if (text.trim().length === 0) break
        const parsed = Number(text)
        if (Number.isNaN(parsed)) {
          errors[fieldName] = 'Enter a valid number'
          break
        }
        if (
          typeof fieldSchema.minimum === 'number' &&
          parsed < fieldSchema.minimum
        ) {
          errors[fieldName] = `Must be at least ${fieldSchema.minimum}`
          break
        }
        if (
          typeof fieldSchema.maximum === 'number' &&
          parsed > fieldSchema.maximum
        ) {
          errors[fieldName] = `Must be at most ${fieldSchema.maximum}`
        }
        break
      }
      case 'array': {
        const selectedValues = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : []
        if (requiredFields.has(fieldName) && selectedValues.length === 0) {
          errors[fieldName] = 'Required'
          break
        }
        if (
          typeof fieldSchema.minItems === 'number' &&
          selectedValues.length < fieldSchema.minItems
        ) {
          errors[fieldName] = `Select at least ${fieldSchema.minItems}`
          break
        }
        if (
          typeof fieldSchema.maxItems === 'number' &&
          selectedValues.length > fieldSchema.maxItems
        ) {
          errors[fieldName] = `Select at most ${fieldSchema.maxItems}`
        }
        break
      }
      case 'boolean':
        break
    }
  }

  return errors
}

function buildAcceptContent(
  schema: FormSchema,
  values: Record<string, unknown>
): Record<string, unknown> {
  const content: Record<string, unknown> = {}

  for (const [fieldName, fieldSchema] of Object.entries(
    schema.properties ?? {}
  )) {
    const value = values[fieldName]
    switch (fieldSchema.type) {
      case 'string':
        content[fieldName] = typeof value === 'string' ? value : ''
        break
      case 'number':
        content[fieldName] =
          typeof value === 'string' && value.trim().length > 0
            ? Number(value)
            : null
        break
      case 'boolean':
        content[fieldName] = Boolean(value)
        break
      case 'array':
        content[fieldName] = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : []
        break
    }
  }

  return content
}

function getMetadataDescription(metadata: unknown): string | null {
  if (!isObject(metadata)) return null
  const toolDescription = metadata.tool_description
  return typeof toolDescription === 'string' ? toolDescription : null
}

export function CodexMcpElicitation({
  sessionId,
  elicitation,
  onRespond,
}: CodexMcpElicitationProps) {
  const schema = useMemo(
    () => asFormSchema(elicitation.requested_schema),
    [elicitation.requested_schema]
  )
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    buildInitialValues(schema)
  )

  const validationErrors = useMemo(
    () => buildValidationErrors(schema, values),
    [schema, values]
  )

  const hasFormFields = Object.keys(schema.properties ?? {}).length > 0
  const metadataDescription = getMetadataDescription(elicitation.metadata)

  return (
    <div className="my-3 rounded border border-amber-500/30 bg-amber-500/5 p-4 font-mono text-sm">
      <div className="mb-3 font-semibold text-foreground">
        MCP Approval Required
      </div>
      <div className="space-y-2 text-muted-foreground">
        <Markdown>{elicitation.message}</Markdown>
        {metadataDescription ? (
          <div className="text-xs">
            <Markdown>{metadataDescription}</Markdown>
          </div>
        ) : null}
      </div>

      {hasFormFields ? (
        <div className="mt-4 space-y-4">
          {Object.entries(schema.properties ?? {}).map(
            ([fieldName, fieldSchema]) => {
              const fieldValue = values[fieldName]
              const error = validationErrors[fieldName]
              const fieldLabel = getFieldLabel(fieldName, fieldSchema)
              const description = fieldSchema.description

              if (fieldSchema.type === 'string') {
                const options = getStringOptions(fieldSchema)
                if (options.length > 0) {
                  return (
                    <div key={fieldName} className="space-y-2">
                      <div>
                        <Label className="font-medium text-foreground">
                          {fieldLabel}
                        </Label>
                        {description ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            <Markdown>{description}</Markdown>
                          </div>
                        ) : null}
                      </div>
                      <RadioGroup
                        value={typeof fieldValue === 'string' ? fieldValue : ''}
                        onValueChange={value =>
                          setValues(current => ({
                            ...current,
                            [fieldName]: value,
                          }))
                        }
                        className="space-y-2"
                      >
                        {options.map(option => (
                          <div
                            key={option.value}
                            className="flex items-start gap-2.5"
                          >
                            <RadioGroupItem
                              value={option.value}
                              id={`${elicitation.rpc_id}-${fieldName}-${option.value}`}
                              className="mt-0.5"
                            />
                            <Label
                              htmlFor={`${elicitation.rpc_id}-${fieldName}-${option.value}`}
                              className="cursor-pointer"
                            >
                              {option.label}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                      {error ? (
                        <div className="text-xs text-destructive">{error}</div>
                      ) : null}
                    </div>
                  )
                }

                return (
                  <div key={fieldName} className="space-y-2">
                    <div>
                      <Label className="font-medium text-foreground">
                        {fieldLabel}
                      </Label>
                      {description ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          <Markdown>{description}</Markdown>
                        </div>
                      ) : null}
                    </div>
                    <Input
                      value={typeof fieldValue === 'string' ? fieldValue : ''}
                      onChange={event =>
                        setValues(current => ({
                          ...current,
                          [fieldName]: event.target.value,
                        }))
                      }
                      className="font-mono text-sm"
                    />
                    {error ? (
                      <div className="text-xs text-destructive">{error}</div>
                    ) : null}
                  </div>
                )
              }

              if (fieldSchema.type === 'number') {
                return (
                  <div key={fieldName} className="space-y-2">
                    <div>
                      <Label className="font-medium text-foreground">
                        {fieldLabel}
                      </Label>
                      {description ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          <Markdown>{description}</Markdown>
                        </div>
                      ) : null}
                    </div>
                    <Input
                      type="number"
                      value={typeof fieldValue === 'string' ? fieldValue : ''}
                      onChange={event =>
                        setValues(current => ({
                          ...current,
                          [fieldName]: event.target.value,
                        }))
                      }
                      className="font-mono text-sm"
                    />
                    {error ? (
                      <div className="text-xs text-destructive">{error}</div>
                    ) : null}
                  </div>
                )
              }

              if (fieldSchema.type === 'boolean') {
                return (
                  <div key={fieldName} className="space-y-2">
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                        id={`${elicitation.rpc_id}-${fieldName}`}
                        checked={Boolean(fieldValue)}
                        onCheckedChange={checked =>
                          setValues(current => ({
                            ...current,
                            [fieldName]: Boolean(checked),
                          }))
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <Label
                          htmlFor={`${elicitation.rpc_id}-${fieldName}`}
                          className="cursor-pointer font-medium text-foreground"
                        >
                          {fieldLabel}
                        </Label>
                        {description ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            <Markdown>{description}</Markdown>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              }

              const options = getStringOptions(fieldSchema)
              const selectedValues = Array.isArray(fieldValue)
                ? fieldValue.filter(
                    (item): item is string => typeof item === 'string'
                  )
                : []

              return (
                <div key={fieldName} className="space-y-2">
                  <div>
                    <Label className="font-medium text-foreground">
                      {fieldLabel}
                    </Label>
                    {description ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        <Markdown>{description}</Markdown>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {options.map(option => (
                      <div
                        key={option.value}
                        className="flex items-start gap-2.5"
                      >
                        <Checkbox
                          id={`${elicitation.rpc_id}-${fieldName}-${option.value}`}
                          checked={selectedValues.includes(option.value)}
                          onCheckedChange={checked =>
                            setValues(current => {
                              const existing = Array.isArray(current[fieldName])
                                ? current[fieldName].filter(
                                    (item): item is string =>
                                      typeof item === 'string'
                                  )
                                : []
                              return {
                                ...current,
                                [fieldName]: checked
                                  ? [...existing, option.value]
                                  : existing.filter(
                                      value => value !== option.value
                                    ),
                              }
                            })
                          }
                          className="mt-0.5"
                        />
                        <Label
                          htmlFor={`${elicitation.rpc_id}-${fieldName}-${option.value}`}
                          className="cursor-pointer"
                        >
                          {option.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {error ? (
                    <div className="text-xs text-destructive">{error}</div>
                  ) : null}
                </div>
              )
            }
          )}
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onRespond(
              sessionId,
              elicitation.rpc_id,
              'accept',
              buildAcceptContent(schema, values)
            )
          }
          disabled={Object.keys(validationErrors).length > 0}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onRespond(sessionId, elicitation.rpc_id, 'decline', null)
          }
        >
          Decline
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onRespond(sessionId, elicitation.rpc_id, 'cancel', null)
          }
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
